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
export {};
