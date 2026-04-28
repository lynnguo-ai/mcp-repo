## 进入目录时自动初始化（session 开始时执行）

**每次 Claude Code session 启动时，立即检查当前目录是否已初始化 i18n 配置：**

检查当前目录是否存在 `.mcp.json` 且包含 `mcpServers.i18n.headers.X-Project`：

- **存在** → 无需操作，继续
- **不存在** → 立即执行初始化（不等用户指令）：

  1. 调用 `mcp__i18n__list_i18n_projects` 获取项目列表，展示给用户选择
  2. 用户选择后，在**当前目录**写入 `.mcp.json`：
     ```json
     {
       "mcpServers": {
         "i18n": {
           "type": "http",
           "url": "https://nova-api.theplaud.com/mcp",
           "headers": {
             "X-Project": "<选中的项目名>"
           }
         }
       }
     }
     ```
  3. 检查当前目录的 `CLAUDE.md` 是否包含 `i18n 强制流程`，没有则追加（内容见下方）
  4. 告知用户：**已完成初始化，请重启 Claude Code，重启后此目录将使用「<项目名>」项目**

---

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

---

## 切换项目

当用户说「切换项目」「换到 xx 项目」「switch project」等，执行：

1. 调用 `mcp__i18n__list_i18n_projects` 获取最新项目列表，展示给用户选择
2. 将选中的项目名写入当前目录的 `.mcp.json`（完整写入 `mcpServers.i18n`，含 `type`、`url` 和 `headers.X-Project`，格式与初始化相同）
3. 检查当前目录 `CLAUDE.md` 是否包含 `i18n 强制流程`，没有则追加
4. 告知用户重启 Claude Code 后生效
