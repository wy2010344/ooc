# packages/playground — AGENTS.md

移动端优先的 OOC「记事本」playground。修改本包前先读这里。

## 定位与原则

- **不是桌面 IDE**，是记事本 App：笔记（IndexedDB）→ 编辑 → 运行。
- 执行结果是「行为」而不是「弹窗」：通过注入的宿主桥接对象持久改变这个 App（类似 Smalltalk）。
- 运行时不拦截类型错误：解释器跑通即可，类型诊断只作提示（黄条），不阻断运行。
- 复用 `object-oriented-c-language`（本仓库 `packages/language`）的 interpret + type-check，**不重复实现语言逻辑**。

## 技术栈（桌面构建可用，Termux 不可用）

- Vite 8（Rolldown）/ React 19 / Tailwind v4 / @headlessui/react / Phosphor Icons。
- 构建依赖 native binding（esbuild/rolldown），Termux 下装不了。修改本包后在桌面 `npm run build -w packages/playground` 验证。

## 结构

- `src/lib/engine.ts` — 单例引擎：虚拟 FileSystemProvider（笔记内存视图）+ 群组桥接 `storage/loop/js/db/ui`。Node 下创建安全（DOM/IndexedDB 惰性）。
- `src/lib/run.ts` — `runNote(engine, name, source)`：先类型检查再解释。**每次运行用唯一会话路径 `__ooc-run-N/<name>`**，避免 Langium 文档注册表重复 URI 报错；basename 保持笔记名供 `#import` 查找。
- `src/lib/store.ts` — IndexedDB（经 **idb** 封装）：笔记 CRUD + 执行历史（`history` store）。不要手写 `openDB`/事务样板。
- `src/hooks/useNotebook.ts` — 状态管理 + 演示笔记播种（首次打开）。
- `src/components/` — App 壳、笔记列表、编辑器（含 `ui add` 改 DOM 的宿主提示）、执行历史 sheet。

## 修改流与红线

1. 语言语法/语义改动一律去 `packages/language`，改完跑 `npm run langium:generate && npm run build && npm test`（根目录）。
2. 改 LSP/引擎相关的浏览器集成交互后，必须补 `test/engine.test.ts`。
3. **禁止**在 playground 引入原生 `.node` 库；`ui add`/`db notes` 这类宿主实验只应被"显式调用"触发，不许模块加载时副作用。
4. 演示笔记固定用 `;` 分隔顶层语句（OOC 规则），不要教用户错误写法。

## 命令

- `npm run dev`（本包目录）：本地 dev。
- `npm run build`：tsc 类型检查 + vite 构建。
- `npm test`（根目录）：`npm test -w packages/playground` 会在本包跑 `tsc -p tsconfig.test.json && node --test "out/test/**/*.test.js"`（node:test，不需要转译）。
- `out/`、`dist/` 为产物，不入库。