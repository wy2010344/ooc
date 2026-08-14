# AGENTS.md — AI 协作守则

本仓库由 AI 协作开发。以下规则务必遵守。架构细节见 `SKILL.md`。

## 1. 项目结构

```
packages/
├── language/     # 核心语言：Grammar、解释器、类型检查、LSP 服务
├── vscode-ooc/   # VSCode 扩展壳，消费 language 的 LSP 服务
└── example/      # 示例 OOC 代码（vite 打包，非 Termux 兼容范围）
```

修改前先确认文件属于哪个包，避免跨包误改。

## 2. 核心原则

- **中文回复**。
- **评估先行**：动手前先评估可行性（工具链、架构影响），不硬上、不绕路。
- **遇到限制时**：优先搜索 skills (`npx skills find <关键词>`)，找不到再问用户。
- **单文件 ≤ 300 行**。超出时拆分模块，遵循高聚合低耦合。
- **代码加中文注释**，方便阅读理解。

## 3. 类型检查 vs 运行（两个独立分支）

- **运行时解释器不做任何类型检查**。`createInterpretAction`（`packages/language/src/interpreter/host.ts`）只拦语法错误，类型错误从不阻断运行。
- 类型检查仅存在于两处：
  - LSP 的 `ConfigAwareDocumentValidator`
  - CLI 的 `ooc type-check`（`createTypeCheckAction`）
- **禁止**把类型诊断逻辑加回解释器路径（`evaluate.ts`、`execDocument`）。

## 4. 工具链约束

- **不可用**：任何需要 `dlopen` 原生 `.node` 的库（vitest 4、rolldown、vite/rollup、SWC、esbuild 的 native binding）——在 Termux/Android 下加载失败。
- **可用**：纯 JS 库、Node 内置（`node:test`）、tsc、esbuild 子进程。
- **测试**：`npm run test`（基于 `node:test`，`test/compat.ts` 复刻 vitest 面 API）。**不要换回 vitest**。
- **构建**：`npm run build`。`packages/example` 的 vite 构建失败属预期，不在 Termux 兼容范围。

## 5. OOC 语言陷阱

- `//` 是**单行注释**，不是除法。除法写法：`12 "/ 3`（`"/` 是消息名）。
- 消息调用用空格分隔，无括号；字符串用单引号。
- 运算符无优先级，左结合。
- `#import` 用相对路径，最后一条表达式是模块导出值。

## 6. Grammar 修改流程

修改 `packages/language/src/object-oriented-c.langium` 后必须：
```bash
npm run langium:generate  # 重新生成 parser/visitor
npm run build             # 编译
npm test                  # 验证
```

`src/generated/` 已 gitignore，不入库。

## 7. 提交与推送

```bash
git add <files>
git commit -m "描述性信息"
git push origin main
```

生成产物（`out/`、`dist/`、`src/generated/`）不入库。

## 8. 调试技巧

已有的调试脚本（仅本地使用，不入库）：
- `debug-ref.mjs` — 调试 ReferencesProvider
- `debug-def.mjs` — 调试 DefinitionProvider
- `debug-hover.mjs` — 调试 HoverProvider

遇到 LSP 问题时，先跑对应 debug 脚本验证 CST 结构，再修改 Provider。

## 9. 测试原则

- 修改 LSP Provider 时，**必须**在 `lsp-smoke.test.ts` 中添加对应测试用例。
- 使用 Langium 测试工具（`expectHover`、`expectCompletion`、`expectFindReferences` 等），不用 try...catch 手写断言。
- 语法测试使用 `langium:generate` 后的 AST 类型，不手动构造。
