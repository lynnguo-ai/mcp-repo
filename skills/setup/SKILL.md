---
name: setup
description: 初始化当前项目的 i18n 配置：选择项目、写入 .mcp.json、写入 CLAUDE.md 规则。安装 nova-i18n 插件后在每个项目目录执行一次。
allowed-tools: Read Edit Write Bash(pwd) Bash(test *) Bash(grep *) mcp__i18n__list_i18n_projects mcp__i18n__set_project
---

按以下步骤完成当前项目的 i18n 初始化：

**步骤 1 — 选择 i18n 项目**

调用 `mcp__i18n__list_i18n_projects` 列出所有可用项目，展示给用户选择。

用户确认后，调用 `mcp__i18n__set_project` 将选择保存到账号。

**步骤 2 — 写入 .mcp.json**

先运行 `pwd` 获取当前工作目录的绝对路径，然后告诉用户：

> 将把 `.mcp.json` 写入：`<pwd输出>/.mcp.json`，确认吗？（输入 y 确认，或输入其他路径）

用户确认或提供新路径后，再执行写入。

- 如果 `.mcp.json` 已存在：只更新 `mcpServers.i18n.headers.X-Project` 字段，保留其他内容
- 如果不存在：创建文件，写入以下内容（`<project>` 替换为用户选择的项目名）：

```json
{
  "mcpServers": {
    "i18n": {
      "type": "http",
      "url": "https://nova-api.theplaud.com/mcp",
      "headers": {
        "X-Project": "<project>"
      }
    }
  }
}
```

**步骤 3 — 写入 CLAUDE.md**

告诉用户：

> 将把 i18n 规则写入：`<pwd输出>/CLAUDE.md`，确认吗？（输入 y 确认，或输入其他路径）

用户确认或提供新路径后，检查该路径的 `CLAUDE.md`：

- **存在且已包含 `i18n 强制流程`** → 告知用户规则已存在，跳过写入
- **存在但不包含** → 在文件末尾追加下方内容
- **不存在** → 创建 `CLAUDE.md` 并写入下方内容

**写入内容：**

```
## i18n 强制流程

**所有涉及界面文案的任务（含 Figma 实现、新功能开发、文案修改）禁止硬编码字符串。必须先完成以下全部步骤，再写第一行 JSX：**

1. **扫描文案**：列出任务中所有需要展示的文字
2. **逐条搜索**：对每条文案调用 `mcp__i18n__search_i18n_keys`，根据结果分三条路径处理：
   - **未找到** → 走步骤 3 新建 key
   - **找到且原文一致** → 直接记录 key 名，进入步骤 4
   - **找到但原文与设计稿不一致**（文案改过）→ 调用 `mcp__i18n__update_source_text(key, new_text)`，之后仍使用原 key 名写代码
3. **补充缺失 key**（搜索不到时，必须在写代码前完成）：
   - 调用 `mcp__i18n__prepare_i18n_key` 创建条目，工具返回原文 + 词库词条
   - 根据词库上下文翻译为全部 11 种语言，调用 `mcp__i18n__save_translations` 保存
   - key 命名规范：`模块_语义描述`，用下划线分隔，如 `workspace_btn_export_pdf`
4. **所有文案确认后**，再生成组件代码，全部用 `useTranslation` + `t('key')`

**硬性禁止**：
- 禁止在 i18n 流程完成前输出任何 JSX/TSX 代码
- 禁止把文字字符串直接硬编码进 JSX
- 禁止跳过 `search_i18n_keys` 直接调用 `prepare_i18n_key`（搜索是必选步骤）
- 禁止在原文变更时跳过 `update_source_text` 直接用旧 key（会导致翻译与设计稿不一致）
```

**步骤 4 — 完成**

告知用户：
- 已选择的项目名
- `.mcp.json` 写入路径
- CLAUDE.md 写入结果（新建 / 追加 / 已存在）
- 提示：切换到其他目录后再次运行 `/setup` 可为该目录选择不同的项目
