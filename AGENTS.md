# AGENTS.md — 与 AI 交互的注意

本仓库由 AI 协作开发，以下规则务必遵守。项目架构细节见 `SKILL.md`。

## 1. 类型检查与运行是两个独立分支

- **运行时解释器不做任何类型检查**。`createInterpretAction`（`packages/language/src/interpreter/host.ts`）只拦语法错误（`syntaxErrorText`），类型错误**从不阻断运行**——能运行就运行。
- 类型检查只发生在两处：IDE/LSP 的 `ConfigAwareDocumentValidator`，以及 CLI 的 `ooc type-check`（`createTypeCheckAction`）。`ooc.json`（`diagnostics-config.ts`）只控制类型检查的显示级别，与运行无关。
- 别把类型诊断、validator、ooc.json 的逻辑加回解释器路径（`evaluate.ts`、`execDocument`）。给解释器「加类型检查」是反设计。

## 2. 工具链约束（Termux/Android）

- 任何需要 dlopen 原生 `.node` 模块的库都不可用：vitest 4 / rolldown、vite / rollup、SWC、esbuild 的 native binding 等，在 Android/Termux 的 linker namespace 下加载失败。
- 可用：纯 JS 库、Node 内置（`node:test`）、tsc、esbuild 子进程可执行文件。
- 测试跑 `npm run test`（`node:test`，`test/compat.ts` 复刻 vitest 小面 API）。**别换回 vitest**。构建用 `npm run build`。

## 3. 语言事实（容易搞错）

- `//` 是单行注释（`SL_COMMENT`），**不是除法**。除法是消息形式：`12 "/ 3`（用 `"/` 消息名，比 `'/'` 更通用，变量接收者上也解析正常）。
- 消息调用用空格分隔，没有函数括号；字符串用单引号。
- 运算符无优先级，左结合；`#import` 用相对路径，最后一条表达式是模块导出值。

## 4. 改动语法

改 `packages/language/src/object-oriented-c.langium` 后必须 `npm run langium:generate` 重新生成，再 build + test。`src/generated` 已在 gitignore，不入库。

## 5. 提交与推送

- git 身份：`wy2010344 <wangyang2010344@foxmail.com>`（仓库级已配置）。
- 推送走 SSH：仓库已配 `core.sshCommand`（`~/.ssh/id_ed25519`，已加入 GitHub），直接 `git push origin main` 即可。
- 生成的 `out/`、`dist/`、`src/generated` 不入库。
