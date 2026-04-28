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

## 切换项目

当用户说「切换项目」「换到 xx 项目」「switch project」等，调用 `mcp__i18n__list_i18n_projects` 列出可用项目，用户选择后调用 `mcp__i18n__set_project` 完成切换，立即生效。
