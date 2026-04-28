#!/usr/bin/env node
/**
 * @plaud/nova-auth — 本地 OAuth 伴侣脚本
 *
 * 用法：
 *   nova-auth                        # 交互式授权 + 项目选择
 *   nova-auth --project web4         # 指定项目后授权
 *   nova-auth --api-url <url>        # 指定 API 地址（默认从 .mcp.json 读取）
 *   nova-auth --force, -f            # 强制重新授权（token 有效也重授）
 *   nova-auth --list-projects        # 列出 .mcp.json 中声明的项目
 *
 * 写入策略（职责分离）：
 *   .mcp.json（项目目录，git 可见）
 *     → 只更新 X-Project 头，记录当前工作项目，不含敏感信息
 *   ~/.claude/settings.json（用户全局，个人）
 *     → 写入完整 MCP 配置（URL + Authorization + X-Project），
 *       用户级优先级高于项目级，Claude Code 会使用此版本
 */

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import open from 'open'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── 常量 ─────────────────────────────────────────────────────────────────────

const FALLBACK_API_URL = 'https://nova-api.theplaud.com'
const CALLBACK_PORT = 8199
const PLAUD_DIR = join(homedir(), '.plaud')
const TOKEN_FILE = join(PLAUD_DIR, 'nova-token.json')
const CONFIG_FILE = join(PLAUD_DIR, 'nova-config.json')
const CLAUDE_SETTINGS = join(homedir(), '.claude', 'settings.json')
const MCP_SERVER_NAME = 'i18n'
const CLIENT_ID = 'nova-auth-cli'
const CALLBACK_PATH = '/auth/callback'
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface TokenData {
  access_token: string
  expires_at: number  // Unix seconds
}

interface NovaConfig {
  api_url: string
  project: string
}

interface McpJson {
  _projects?: Record<string, string>
  mcpServers?: {
    i18n?: {
      url?: string
      headers?: Record<string, string>
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

// ── .mcp.json 读取 ────────────────────────────────────────────────────────────

/**
 * 从当前目录向上查找 .mcp.json，读取 i18n 服务器 URL 和项目列表。
 * 允许在任意子目录中运行 nova-auth，自动定位 monorepo 根。
 * 同时返回文件路径，供写回时使用。
 */
function readMcpJson(): { apiUrl?: string; projects?: Record<string, string>; mcpPath?: string } {
  let dir = process.cwd()
  for (let i = 0; i < 10; i++) {
    const mcpPath = join(dir, '.mcp.json')
    if (existsSync(mcpPath)) {
      try {
        const config = JSON.parse(readFileSync(mcpPath, 'utf-8')) as McpJson
        const rawUrl = config.mcpServers?.i18n?.url
        const apiUrl = rawUrl ? new URL(rawUrl).origin : undefined
        return { apiUrl, projects: config._projects, mcpPath }
      } catch { /* 解析失败则继续向上找 */ }
    }
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return {}
}

/**
 * 将选中的项目名写回 .mcp.json 的 X-Project 头。
 * 只更新 headers['X-Project']，其余字段原样保留，不破坏文件已有结构。
 * X-Project 不敏感，写入 git 可见的 .mcp.json 是刻意的设计：
 * 让项目文件直观地反映当前工作项目。
 */
function updateMcpJson(mcpPath: string, project: string): void {
  let config: McpJson = {}
  try {
    config = JSON.parse(readFileSync(mcpPath, 'utf-8')) as McpJson
  } catch {
    console.warn(`⚠️  无法读取 ${mcpPath}，跳过写回`)
    return
  }

  config.mcpServers ??= {}
  config.mcpServers.i18n ??= {}
  config.mcpServers.i18n.headers ??= {}
  config.mcpServers.i18n.headers['X-Project'] = project

  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n')
}

// ── 配置持久化 ────────────────────────────────────────────────────────────────

function ensurePlaudDir(): void {
  if (!existsSync(PLAUD_DIR)) mkdirSync(PLAUD_DIR, { recursive: true })
}

function loadConfig(): Partial<NovaConfig> {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Partial<NovaConfig>
  } catch {
    return {}
  }
}

function saveConfig(config: NovaConfig): void {
  ensurePlaudDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

function loadToken(): TokenData | null {
  try {
    const data = JSON.parse(readFileSync(TOKEN_FILE, 'utf-8')) as TokenData
    // 预留 5 分钟余量，避免请求中途过期
    if (data.expires_at > Date.now() / 1000 + 300) return data
    return null
  } catch {
    return null
  }
}

function saveToken(data: TokenData): void {
  ensurePlaudDir()
  writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2) + '\n')
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const verifier = Buffer.from(raw).toString('base64url')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = Buffer.from(hash).toString('base64url')
  return { verifier, challenge }
}

// ── OAuth 授权流程 ────────────────────────────────────────────────────────────

async function doOAuthFlow(apiUrl: string): Promise<string> {
  const { verifier, challenge } = await generatePKCE()
  const state = crypto.randomUUID()

  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res
    rejectCode = rej
  })

  const server = createServer((req, res) => {
    if (!req.url) { res.writeHead(400); res.end(); return }
    const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`)
    if (url.pathname !== CALLBACK_PATH) { res.writeHead(404); res.end(); return }

    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    const isOk = Boolean(code)

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Nova Auth</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:48px 40px;width:100%;max-width:400px;text-align:center}
  .icon{font-size:48px;margin-bottom:20px}
  h1{font-size:20px;font-weight:600;color:#1e293b;margin-bottom:10px}
  p{font-size:14px;color:#64748b;line-height:1.6}
</style></head>
<body><div class="card">
  <div class="icon">${isOk ? '✅' : '❌'}</div>
  <h1>${isOk ? 'Authorization Complete' : 'Authorization Failed'}</h1>
  <p>${isOk ? 'You can close this window and return to the terminal.' : `Error: ${error ?? 'unknown'}`}</p>
</div></body></html>`)

    if (code) resolveCode(code)
    else rejectCode(new Error(`OAuth error: ${error ?? 'unknown'}`))
  })

  await new Promise<void>((resolve, reject) =>
    server.listen(CALLBACK_PORT, '127.0.0.1', () => resolve()).on('error', reject)
  )

  const authUrl = new URL(`${apiUrl}/oauth/authorize`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  console.log('\n正在打开浏览器，请完成 Slack 登录...')
  console.log('若浏览器未自动打开，请手动访问：')
  console.log(authUrl.toString(), '\n')
  open(authUrl.toString()).catch(() => {
    console.log('浏览器启动失败，请手动复制上方 URL。')
  })

  const code = await Promise.race([
    codePromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('等待授权超时（10 分钟）')), 600_000)
    ),
  ]).finally(() => {
    server.closeAllConnections?.()
    server.close()
  })

  const tokenRes = await fetch(`${apiUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
    }),
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    throw new Error(`换取 token 失败 (${tokenRes.status}): ${text.slice(0, 200)}`)
  }

  const { access_token, expires_in } = await tokenRes.json() as {
    access_token: string
    expires_in: number
  }

  saveToken({
    access_token,
    expires_at: Math.floor(Date.now() / 1000) + (expires_in ?? 86400),
  })

  return access_token
}

// ── Claude Code MCP 配置写入 ─────────────────────────────────────────────────

/**
 * 写入 ~/.claude/settings.json。
 * 用户级配置优先级高于项目级 .mcp.json，无需修改受 git 管理的文件。
 * 只更新 mcpServers.i18n，保留其他所有字段。
 */
function updateClaudeSettings(jwt: string, project: string, apiUrl: string): void {
  let settings: Record<string, unknown> = {}

  if (existsSync(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf-8')) as Record<string, unknown>
    } catch {
      console.warn('⚠️  ~/.claude/settings.json 解析失败，将重新写入')
    }
  }

  const mcpServers = (settings.mcpServers as Record<string, unknown> | undefined) ?? {}
  mcpServers[MCP_SERVER_NAME] = {
    type: 'http',
    url: `${apiUrl}/mcp`,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Project': project,
    },
  }
  settings.mcpServers = mcpServers

  writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n')
}

// ── 交互式输入 ───────────────────────────────────────────────────────────────

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()) })
  })
}

/**
 * 显示项目菜单并让用户选择序号。
 * projects: { web: "plaud-web (2478 keys)", app: "...", ... }
 */
async function pickProject(projects: Record<string, string>): Promise<string> {
  const entries = Object.entries(projects)
  console.log('\n可用项目：')
  entries.forEach(([key, label], i) => {
    console.log(`  ${i + 1}. ${key.padEnd(12)} ${label}`)
  })
  console.log()

  while (true) {
    const input = await promptLine(`请选择项目 [1-${entries.length}] 或直接输入项目名称: `)
    const num = Number(input)
    if (!isNaN(num) && num >= 1 && num <= entries.length) {
      return entries[num - 1][0]
    }
    if (Object.prototype.hasOwnProperty.call(projects, input)) {
      return input
    }
    if (input) {
      // 允许输入 .mcp.json 中未列出的项目名
      const confirmed = await promptLine(`"${input}" 不在列表中，确认使用？(y/N): `)
      if (confirmed.toLowerCase() === 'y') return input
    }
    console.log('输入无效，请重试。')
  }
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const getFlag = (flag: string): string | null => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : null
  }
  const hasFlag = (flag: string): boolean => argv.includes(flag)

  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Usage: nova-auth [options]

Options:
  --project <name>     设置当前项目（如 web, app, app_h5, desktop）
  --api-url <url>      nova-api 地址（默认从 .mcp.json 读取）
  --force, -f          强制重新授权（即使 token 有效）
  --list-projects      列出 .mcp.json 中声明的项目
  --help, -h           显示帮助

Token 存储: ~/.plaud/nova-token.json
配置存储:   ~/.plaud/nova-config.json
MCP 配置:   ~/.claude/settings.json
    `.trim())
    return
  }

  // 从 .mcp.json 读取默认值（走到哪，找到哪）
  const { apiUrl: mcpApiUrl, projects: mcpProjects, mcpPath } = readMcpJson()

  const savedConfig = loadConfig()
  const apiUrl = getFlag('--api-url') ?? mcpApiUrl ?? savedConfig.api_url ?? FALLBACK_API_URL
  const force = hasFlag('--force') || hasFlag('-f')

  // ── --list-projects ──────────────────────────────────────────────────────
  if (hasFlag('--list-projects')) {
    if (mcpProjects && Object.keys(mcpProjects).length > 0) {
      console.log('来自 .mcp.json 的项目列表：')
      for (const [key, label] of Object.entries(mcpProjects)) {
        console.log(`  ${key.padEnd(12)} ${label}`)
      }
    } else {
      console.log('未找到 .mcp.json 或其中无项目列表')
    }
    return
  }

  // ── Token ────────────────────────────────────────────────────────────────
  const existingToken = loadToken()
  let jwt: string

  if (!force && existingToken) {
    const hours = Math.round((existingToken.expires_at - Date.now() / 1000) / 3600)
    console.log(`✓ 使用已有 token（剩余约 ${hours} 小时）`)
    jwt = existingToken.access_token
  } else {
    if (force && existingToken) console.log('强制重新授权...')
    else console.log('Token 不存在或已过期，开始授权流程...')
    jwt = await doOAuthFlow(apiUrl)
    console.log(`✓ 授权成功，token 已保存到 ${TOKEN_FILE}`)
  }

  // ── 项目选择（CLI flag > 已保存 > 交互菜单）──────────────────────────────
  let project = getFlag('--project') ?? savedConfig.project ?? null

  if (!project) {
    if (mcpProjects && Object.keys(mcpProjects).length > 0) {
      project = await pickProject(mcpProjects)
    } else {
      project = await promptLine('\n请输入项目名称（如 web, app）: ')
      if (!project) {
        console.error('❌ 项目名称不能为空')
        process.exit(1)
      }
    }
  }

  // ── 写入配置 ─────────────────────────────────────────────────────────────
  // 1. ~/.claude/settings.json：完整 MCP 配置（含 JWT），用户级优先
  updateClaudeSettings(jwt, project, apiUrl)
  // 2. .mcp.json：只更新 X-Project，记录当前项目，不含 JWT
  if (mcpPath) updateMcpJson(mcpPath, project)
  saveConfig({ api_url: apiUrl, project })

  console.log('\n✓ Claude Code MCP 已配置：')
  console.log(`  服务器  ${apiUrl}/mcp`)
  console.log(`  项目    ${project}`)
  console.log(`  JWT     ${CLAUDE_SETTINGS}`)
  if (mcpPath) console.log(`  项目名  ${mcpPath}  (X-Project: ${project})`)
  console.log('\n重启 Claude Code 使配置生效。')
  console.log('Token 24 小时后过期，届时重新运行 nova-auth 即可。')
}

main().catch((err: unknown) => {
  console.error('❌', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
