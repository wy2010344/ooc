# AGENTS.md — AI 协作守则

本仓库由 AI 协作开发。以下规则务必遵守。架构细节见 `SKILL.md`。

## 1. 项目结构

```
packages/
├── language/          # 核心语言：Grammar、解释器、类型检查、LSP 服务
├── cli/               # CLI：compile / build / interpret / type-check / init
├── vite-plugin-ooc/   # Vite 插件：直接 import .ooc
├── extension/         # VSCode 扩展壳，消费 language 的 LSP 服务
├── example/           # 示例 OOC 代码（vite 打包，非 Termux 兼容范围）
├── playground/        # 浏览器 playground（预载 base 库）
├── ooc-mve-bridge/    # MVE/宿主桥接（dom、信号等）
└── base/              # 共享 OOC 源码库（无 package.json）
```

修改前先确认文件属于哪个包，避免跨包误改。

## 2. 核心原则

- **中文回复**。
- **快速迭代期，不做向后兼容**：API 以最小、最干净为准。旧写法、旧行为、旧的调用姿势改了就改掉，不为兼容留垫片、双路分支或多余抽象；哪天需要兼容再单独补。代码里已有的兼容路径（如同时支持新旧两种写法）默认视为冗余，发现即清理。
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
- **wy-helper 信号调度 vs 测试进程挂起**：≤1.1.3 在模块加载时即创建 MessageChannel 端口，会让 `node --test` 跑完用例后进程挂起。各包测试脚本必须带 `node --import ./test/preload-batch.mjs`（先置空 `globalThis.MessageChannel` 兜底，再调 `wy.setBatchRunner(fn => setTimeout(fn))` 显式注入测试调度，≥1.1.4 支持）。language 和 playground 均已配好，删掉会回归挂起。
- **构建**：`npm run build`。`packages/example` 的 vite 构建失败属预期，不在 Termux 兼容范围。
- **example 示例**：`packages/example` 已接 Tailwind v4（`@tailwindcss/vite`）+ 复刻 shadcn 组件（`src/ooc/ui/*.ooc` 一组件一文件：`button`/`badge`/`input`/`card`/`checkbox`/`switch`/`select`/`tabs`/`table`/`avatar`/`separator`/`skeleton`/`dropdown-menu`/`context-menu`/`dialog`/`sheet`，工具 `utils.ooc` 提供 `cn`/`pick`/`merge`/`noop`/`when`）。组件统一约定：**props 对象（可 `{}` 全默认）+ children 剩余参数 + className 用模板字符串 + `pick`**；`when $ cond a b` 是布尔分流（语言无三元，等价 `#guard cond; a #else; b`）。回调一律写成**方法**（`onPress(e){ … }`），组件内 `p onPress e` 直接调用，不再包 lambda。浮层用 **Portal + floating-ui**：桥接提供 `createPop(render)`（`render(ctx, close)`，返回 `close`；`main.ts` 在根渲染流程里调 `renderPop()`，弹层与 `#app` 同一 root，需先 `provideIconContext`）、`floating $ { reference, placement, offset, matchWidth, className } …children` 定位（`point` 用光标坐标作参照，右键菜单用；弹层节点必须 `position: absolute`，与 floating-ui 默认 strategy 一致，写 `fixed` 会跑到屏外）、`hookTrackSignal $ [get] [set]` 跟随信号；`Dialog`/`Sheet`/`DropdownMenu`/`ContextMenu` 一律是**函数**（非组件）：在触发元素的事件里调用 `createPop`（portal），items 经 `createContext`（`MenuCtx`/`CtxMenuCtx`）拿 `close` 自关；触发元素由调用方给（Dropdown 传 `reference = (e currentTarget)`，Context 传 `x`/`y` 光标坐标）——两者都要在**事件期同步读出**（`createPop` 是延迟渲染，出了事件 `currentTarget` 就是 nil）；`floating` 传 `onDismiss`（点外部 / Esc 回调）与 `dismissIgnore`（忽略触发按钮）实现关闭；`Dialog`/`Sheet` 的 `close` 由调用方存起来关闭；图标用 `iconCheck`/`iconChevronDown`/`iconX`。**类名与 variant 逻辑全写在 `.ooc`**，靠 `src/style.css` 的 `@source './ooc'` 让 Tailwind 扫到（已实测 `.ooc` 里的工具类会进产物）；仅桌面构建可用。信号用 `bindSignal $ x` 包成 lambda：`x $` 读、`x $ v` 写；任意 `{get,set}` 持有者（如 `storage ref`）用 `multiBind $ holder`。

- **example 组合页**：`src/ooc/pages/*.ooc` 一区块一文件，`settings.ooc` 组装 `stat-card`/`showcase`/`variant-demo`/`kit`；`kit.ooc` 再组装 `form-controls`（Checkbox/Switch/Select）、`menu-demo`（DropdownMenu/ContextMenu）、`data-display`（Tabs/Table/Avatar/Separator/Skeleton）、`overlay-demo`（Dialog/Sheet）。

## 5. OOC 语言陷阱

- `//` 是**单行注释**，不是除法。除法写法：`12 div 3`（`div` 是消息名）。`/` 是级联符，`/` 是独立 token，`list get/ at i`、`list get /filter [...]/length` 无空格连写也合法。
- 消息调用用空格分隔，无括号；字符串用单引号。
- **`$` 是「直接调用」**（定义键、消息名、中缀运算符三处都用它，OOC surface 不出现 `apply`）：`f $ x` ≡ 调用 `f`；**定义也写 `$`**（`{ $(x) => ... }`、`{ $(x) { ... } }`）。`$` 还能当**中缀运算符**（同加减乘除，左结合）——消息链后直接接 `$`，无需前置 `/`：`close get $ false` ≡ `close get / $ false`，右侧接 **0~N 个实参**（可省：`x get $` 即零参调用；`h get $ 1 2 3` 传三参）。解析出 `Dollar` 节点，运行时/codegen/类型检查/LSP 一律按成员名 `$` 处理（宿主 JS 侧同名，无归一）。词法陷阱：`$` 与模版洞起始 `${` 共前缀，`$` 后紧跟 `{` 会被 lex 成 `${`，故必须写 `f $ {…}`（留空格）。
- 运算符无优先级，左结合。
- **绑定都是 const：同层作用域不允许同名重新声明**（`duplicateDeclaration`，error）。`x = ...` 是声明不是重新赋值；作用域只有四层——顶层（`#import` 绑定 / `#type` / 顶层赋值）、方法体（类型参数 + 参数 + 全部语句，`#guard` / `#else` 分支**不另开**作用域）、绑定块 `@{ … }`、lambda 体。不同层可同名（内层遮蔽外层）。改数据用 `storage ref` / `toSpliced` 等。
- **对象成员 `=` 是常量绑定**：**纯字面量**（str/num/bool/nil）编译/构建成数据属性（构造期写值一次），**计算式**是 getter（惰性求值一次并缓存）；`=>` 单行与 `{ ... }` 方法体都是**方法**——编译成**只读数据函数**，每次**调用**执行（零参成员也是方法：读 `obj m` 发消息才执行；JS 直读 `.m` 拿到函数本体）。事件/跟随信号的属性必须用 `=>`（`onClick = ...` 会拿到构造时的旧值）。**纯字面量常量成员只能写 `=`**：零参方法体只返回 str/num/bool/nil 字面量时写 `{ 'x' }` / `=> 'x'` 会被 validator 以 `constMethodBody` 报 error（字面量恒定，绑定一次缓存更省，宿主也才能按「数据属性＝常量、数据函数＝方法」准确分流）；带参/带泛型/多语句/非字面量不受限。成员形态完全由 descriptor 承载（getter＝绑定值、只读数据函数＝方法），**没有标记符号**。
- **零参方法不能写 `()`**：`$ { … }` / `$ => …`（`$()` 会报 `Expecting token of type ']'` 之类的解析错误）；lambda 无参写 `[expr]`。
- **`#guard` 分支是平级兄弟**：一个方法体里 `#guard a; … #guard b; … #else; …`，**不能把 `#guard` 嵌在另一个分支的语句里**（会报 `Expecting token of type '}' but found '#guard'`，并级联误报到外层 `= {`）。注意**连写的两个 `#guard` 是 if / else-if**（命中即返回）：若两段都要执行，把第一段的语句提到 `#guard` 之前（否则第一条命中就返回，第二段永不执行）。
- **管道 `|` 参数前置**（thread-first）：`et index|remove $` ≡ `remove $ (et index)`；`|` 右侧必须是一条消息链，单消息要写 `| f $`。
- **数组直接用 JS 生态**：`Array` 是 globalThis 全局对象，`(Array of)` 构造数组（含空数组）；不可变改数据用数组原生 `toSpliced`：`xs / toSpliced 1 0 {...}`（返回新数组）。
- **模版字符串**：直接用单引号字符串插值，如 `'你好 ${name}!'`。整段单引号字符串是一个普通 `STRING` token（Langium 无 lexer mode，词法层切不开文本/代码），解析后由 `template-graft.ts` 按原文把 `${表达式}` 洞子解析并挂进 `Str.parts`（`TemplateText`/`TemplateHole`）；**只有含洞的字符串才填 `parts`**，纯字符串保持原 `value` 语义（含「纯字面量＝数据属性」判定）。codegen/解释器/类型检查/LSP 共用同一 AST。文本转义按 Langium STRING 口径还原（`\n`/`\t`/`\'`/`\$`…），`\$` 可写不触发插值的字面 `${`。**洞内不能含未转义单引号**（整段是一个单引号 token）。`#import` 等不经 DocumentBuilder 的路径（如 vite 插件 `fromString`）需手动调 `graftTemplates`。
- `#import` 用相对路径（`./`、`../` 或裸名），最后一条表达式是模块导出值。跨目录复用源码同样只用相对路径，没有包安装/包前缀机制；`packages/base/src/loop.ooc` 由 example 以 `#import '../../../base/src/loop'` 直接复用，playground 则按 basename 从预载库命中。

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
