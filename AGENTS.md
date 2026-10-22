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
- **example 示例**：`packages/example` 已接 Tailwind v4（`@tailwindcss/vite`）+ 复刻 shadcn 组件（`src/ooc/ui/*.ooc` 一组件一文件：`button`/`badge`/`input`/`card`/`checkbox`/`switch`/`select`/`tabs`/`table`/`avatar`/`separator`/`skeleton`/`dropdown-menu`/`context-menu`/`dialog`/`sheet`，工具 `utils.ooc` 提供 `cn`/`pick`/`merge`/`noop`/`when`）。组件统一约定：**props 对象（可 `{}` 全默认）+ children 剩余参数 + className 用模板字符串 + `pick`**；`when $ cond a b` 是布尔分流（语言无三元，等价 `#guard cond; a #else; b`）。回调一律写成**方法**（`onPress(e){ … }`），组件内 `p onPress e` 直接调用，不再包 lambda。浮层用 **Portal + floating-ui**：桥接提供 `createPop(render)`（`render(ctx, close)`，返回 `close`；`main.ts` 在根渲染流程里调 `renderPop()`，弹层与 `#app` 同一 root，需先 `provideIconContext`）、`floating $ { reference, placement, offset, matchWidth, className } …children` 定位（`point` 用光标坐标作参照，右键菜单用；弹层节点必须 `position: absolute`，与 floating-ui 默认 strategy 一致，写 `fixed` 会跑到屏外）、`hookTrackSignal $ [get] [set]` 跟随信号；`Dialog`/`Sheet`/`DropdownMenu`/`ContextMenu` 一律是**函数**（非组件）：在触发元素的事件里调用 `createPop`（portal），items 经 `createContext`（`MenuCtx`/`CtxMenuCtx`）拿 `close` 自关；触发元素由调用方给（Dropdown 传 `reference = (e currentTarget)`，Context 传 `x`/`y` 光标坐标）——两者都要在**事件期同步读出**（`createPop` 是延迟渲染，出了事件 `currentTarget` 就是 nil）；`floating` 传 `onDismiss`（点外部 / Esc 回调）与 `dismissIgnore`（忽略触发按钮）实现关闭；`Dialog`/`Sheet` 的 `close` 由调用方存起来关闭；图标用 `iconCheck`/`iconChevronDown`/`iconX`。**类名与 variant 逻辑全写在 `.ooc`**，靠 `src/style.css` 的 `@source './ooc'` 让 Tailwind 扫到（已实测 `.ooc` 里的工具类会进产物）；仅桌面构建可用。信号用 `bindSignal $ x` 包成 lambda：`x $` 读、`x $ v` 写；任意 `{get,set}` 持有者（如 `storage ref`）用 `multiBind $ holder`。`forEach` 的 `creater` 只构建一次，`et` 是每行 SubHolder：`et value/ field` 必须写在 `=>` / `[...]` / `text` 的 getter 内，提前 `t = (et value)` 会冻结该行数据。

- **example 组合页**：`src/ooc/pages/*.ooc` 一区块一文件，`settings.ooc` 组装 `stat-card`/`showcase`/`variant-demo`/`kit`；`kit.ooc` 再组装 `form-controls`（Checkbox/Switch/Select）、`menu-demo`（DropdownMenu/ContextMenu）、`data-display`（Tabs/Table/Avatar/Separator/Skeleton）、`overlay-demo`（Dialog/Sheet）。

## 5. OOC 语言陷阱

- `//` 是**单行注释**，不是除法。除法写法：`12 div 3`（`div` 是消息名）。`/` 是级联符，`/` 是独立 token，`list get/ at i`、`list get /filter [...]/length` 无空格连写也合法。
- 消息调用用空格分隔，无括号；字符串用单引号。
- **动态消息名是 `Object` 的专属消息**：`Object send 目标 '名字' 实参…`（唯一数组实参视为实参列表）。
  普通对象**不**响应 `send`——`obj send 'x'` 抛「没有定义该方法 send」。名字一旦是运行时值，
  补全/悬停/跳转全退化为 unknown，类型检查也不参与，所以只给「静态分析帮不上」的场合用（如 `ui/utils.ooc` 的 `pick`）。
- **顶层语句用 `;` 分隔**：换行只是空白，不是分隔符。少写 `;` 时两条语句会被并成一条消息链——
  有时直接 parse error，有时只出一条「调用参数不匹配」warning 而值已经不对（README 首个示例就这么错过一次，
  现在由 `npm run test:docs` 兜住）。
- **没有一元负号**：`-` 只在中缀位置，`f r -1` ≡ `(f r) - 1` → `NaN`，**不报错**。负数写 `0 - 1` 或先绑定再传。
- **`$` 是「直接调用」**（定义键、消息名、中缀运算符三处都用它，OOC surface 不出现 `apply`）：`f $ x` ≡ 调用 `f`；**定义也写 `$`**（`{ $(x) => ... }`、`{ $(x) { ... } }`）。`$` 还能当**中缀运算符**（同加减乘除，左结合）——消息链后直接接 `$`，无需前置 `/`：`close get $ false` ≡ `close get / $ false`，右侧接 **0~N 个实参**（可省：`x get $` 即零参调用；`h get $ 1 2 3` 传三参）。解析出 `Dollar` 节点，运行时/codegen/类型检查/LSP 一律按成员名 `$` 处理（宿主 JS 侧同名，无归一）。词法陷阱：`$` 与模版洞起始 `${` 共前缀，`$` 后紧跟 `{` 会被 lex 成 `${`，故必须写 `f $ {…}`（留空格）。
- 运算符无优先级，左结合。
- **绑定都是 const：同层作用域不允许同名重新声明**（`duplicateDeclaration`，error）。`x = ...` 是声明不是重新赋值；作用域只有四层——顶层（`#import` 绑定 / `#type` / 顶层赋值）、方法体（类型参数 + 参数 + 全部语句，`#guard` / `#else` 分支**不另开**作用域）、绑定块 `@{ … }`、lambda 体（方法体与 lambda 体都是「参数 + 全部语句」一层，分支语句不另开）。不同层可同名（内层遮蔽外层）。改数据用 `storage ref` / `toSpliced` 等。
- **对象成员 `=` 是常量绑定**：**纯字面量**（str/num/bool/nil）编译/构建成数据属性（构造期写值一次），**计算式**是 getter（惰性求值一次并缓存）；`=>` 单行与 `{ ... }` 方法体都是**方法**——编译成**只读数据函数**，每次**调用**执行（零参成员也是方法：读 `obj m` 发消息才执行；JS 直读 `.m` 拿到函数本体）。事件/跟随信号的属性必须用 `=>`（`onClick = ...` 会拿到构造时的旧值）。**纯字面量常量成员只能写 `=`**：零参方法体只返回 str/num/bool/nil 字面量时写 `{ 'x' }` / `=> 'x'` 会被 validator 以 `constMethodBody` 报 error（字面量恒定，绑定一次缓存更省，宿主也才能按「数据属性＝常量、数据函数＝方法」准确分流）；带参/带泛型/多语句/非字面量不受限。成员形态完全由 descriptor 承载（getter＝绑定值、只读数据函数＝方法），**没有标记符号**。
- **零参方法不能写 `()`**：`$ { … }` / `$ => …`（`$()` 会报 `Expecting token of type ']'` 之类的解析错误）；lambda 无参写 `[expr]`。
  **`[=> …]` 也不合法**（`=>` 前面必须有参数），多语句写 `[a = …; b]`，要早退就用 `[a = …; #guard a; …]`。
- **量元素尺寸走 `plugin` / `willRemove` 挂载钩子**：`(dom div { plugin(el){ … }, willRemove(el){ … } })`，
  `plugin` 在元素建好后立刻回调（不在布局期），`willRemove` 在移除时回调。配合 `dashboard/measure.ts` 的
  `watchSize`（ResizeObserver）把宽高写进信号即可；**首次尺寸交给 ResizeObserver 的首个回调**，
  不要在 `plugin` 里同步写信号（会在构建期写状态）。返回值是断开函数，交给 `willRemove` 调用。
- **函数调用漏 `$` 会变成消息发送**：`formatTotal v x` 不是调用而是「给 `formatTotal` 发 `v` 消息」，
  运行时报 `OOC 方法未找到: function …`；而且**渲染会在该处中断**，表现为某一列整体消失、列表只出一行。
  见到「少一列 / 只渲染首个节点」先按这条查。
- **`#import` 没有 `from`**：语法是 `#import { A, B } './m.ooc'`（花括号在 path 前）。跨行写、
  花括号内换行都**合法**，只要语句之间用 `;` 分隔；写成 `from` 会报
  `Expecting token of type 'STRING' but found 'from'`。
- **`when $ cond a b` 是急求值的**：两支都会算，所以 `when $ d (d asks) nil` 在 `d` 为 nil 时照样会炸。
  读可能为 nil 的字段前先落到 `#guard` 形式的小 lambda（`[d => #guard d; d asks #else; nil]`）里。
- **`#guard` 分支是平级兄弟**：方法体或 lambda 体里 `#guard a; … #guard b; … #else; …`，**不能把 `#guard` 嵌在另一个分支的语句里**（会报 `Expecting token of type '}' but found '#guard'`，并级联误报到外层 `= {`）。注意**连写的两个 `#guard` 是 if / else-if**（命中即返回）：若两段都要执行，把第一段的语句提到 `#guard` 之前（否则第一条命中就返回，第二段永不执行）。
- **管道 `|` 参数前置**（thread-first）：`et index|remove $` ≡ `remove $ (et index)`；`|` 右侧必须是一条消息链，单消息要写 `| f $`。
- **数组直接用 JS 生态**：`Array` 是 globalThis 全局对象，`(Array of)` 构造数组（含空数组）；不可变改数据用数组原生 `toSpliced`：`xs / toSpliced 1 0 {...}`（返回新数组）。
- **模版字符串**：直接用单引号字符串插值，如 `'你好 ${name}!'`。整段是一个 `STRING` token，但**收尾位置由扫描器算**（`template.ts` 的 `scanQuotedString`/`scanHole`，经 `token-builder.ts` 的自定义 token matcher 接进词法）——因为正则不知道 `${}` 的深度。所以洞内可以正常写单引号：`'${v if '' 'hidden'}'`、`'A${'b${n}c'}D'` 都合法。解析后 `template-graft.ts` 按同一份扫描规则把洞子解析并挂进 `Str.parts`（`TemplateText`/`TemplateHole`）；**只有含洞的字符串才填 `parts`**，纯字符串保持原 `value` 语义（含「纯字面量＝数据属性」判定）。codegen/解释器/类型检查/LSP 共用同一 AST。文本转义按 Langium STRING 口径还原（`\n`/`\t`/`\'`/`\$`…），`\$` 可写不触发插值的字面 `${`。不经 DocumentBuilder 的路径要自己 graft：vite 插件 `fromString` 与解释器（`getOrCreateDocument` 创建即解析）都显式调了 `graftTemplates`。
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

仓库根目录下有一批本地调试脚本（`debug-*.mjs`，均不入库）：

- `debug-mcp.mjs` — 直连 chrome-devtools MCP（隔离 Edge）。改页面状态、截图、读控制台，
  是最常用的一支；其余 `debug-mcp-probe2.mjs` / `debug-mcp-schema.mjs` 是它的探针。
- `debug-completion.mjs` / `debug-import-lsp.mjs` — LSP（补全、跨模块导入）验证。
- `debug-e2e.mjs` / `debug-pw.mjs` — 端到端流程。
- 其余（`debug-canvas` / `debug-const-member` / `debug-editor` / `debug-net` / `debug-note` /
  `debug-preview` / `debug-tokens`）是一次性问题探针，用完即可删。

遇到 LSP 问题时，先跑对应 debug 脚本验证 CST 结构，再修改 Provider。

## 9. 测试原则

- 修改 LSP Provider 时，**必须**在 `lsp-smoke.test.ts` 中添加对应测试用例。
- 使用 Langium 测试工具（`expectHover`、`expectCompletion`、`expectFindReferences` 等），不用 try...catch 手写断言。
- 语法测试使用 `langium:generate` 后的 AST 类型，不手动构造。
- **文档示例必须可校验**：`npm run test:docs` 会把 README 与 `docs/guide/**` 里的 ```ooc 块抽出来跑
  同一套类型检查（`scripts/check-docs.mjs`）。改写示例后跑一遍；片段/跨包路径/故意演示诊断的块，
  在代码块上一行写 `<!-- ooc-check: skip — 原因 -->` 或 `<!-- ooc-check: warning — 原因 -->`。
  依赖同目录模块的示例用 `docs/guide/_fixtures/` 里的 fixture（`math.ooc` / `geometry.ooc` / `lib.ooc`）。

## 10. example 行情页的数据源（dashboard）

`packages/example/src/ooc/dashboard/` 是币安公开行情的终端示例，页面**只从 `feed.ts` 取数**：

- `feed.ts` 是数据门面，`market.ts` 是引擎（Gateway：REST 基址 + 组合流入口 + `transport: 'ws' | 'sse'`）。
- 两个源：币安官方（`LIVE_GATEWAY`，WS）与本机伪报文（`http://localhost:8787`，SSE）。
  伪报文服务是独立仓库 **`C:\github\mock-api`**（`npm run dev`，端口固定 8787，REST 在 `/api/v3/**`、流在 `/stream`），
  它的报文与币安完全一致，所以切源只是换基址。
- 切换入口：`?feed=live|mock`、`?mock=http://host:port`、`VITE_MOCK_API`、localStorage、页面右上角 MOCK 按钮。
  切到伪报文前会先 `GET /api/v3/ping` 探活，服务没起就只提示、不改源；币安 418/429 等硬错误会**自动**接管到伪报文。
- 伪报文地址一律经 `parseOrigin()` 归一（`parseOrigin` 认 `8787` / `localhost` / `localhost:8787` / `http://host:port`，
  认不出来返回 `null` 并丢弃）。**不要**把地址直接拼进 URL：半截字符串会变成相对路径打到 dev server 自己身上（5173 的 404）。
- 不要在页面里直接 `fetch` 币安域名，也不要绕过 `feed.ts` 新建会话——否则切换/降级都失效。
- **深度 / 盘口走本地订单簿**（`order-book.ts`）：`GET /api/v3/depth?limit=5000` 只拉一次铺底，
  之后靠 `<symbol>@depth@100ms` 增量帧（`U`/`u` + `b`/`a`）逐帧修正，**不再定时轮询 REST**
  （5000 档快照权重 50，5 秒一次是全套接口里最贵的取法）。同步规则：丢弃 `u <= lastUpdateId`、首帧须
  `U <= lastUpdateId+1 <= u`、缺帧/重连都重拉快照。`onDepth` 一份数据同时喂盘口与深度图。
- 伪报文的 `@depth` 也要发真增量帧（`mock-api` 里 `streamDepthDiff`），否则切到 mock 时深盘口会空。
- **盘口行口径对齐币安现货**（`orderbook-rows.ts`，用 chrome-devtools MCP 实地量过）：三列
  Price / Amount / Total，其中 `Total` 是**该档的名义金额**（Σ price×qty，不是累计量），大数按 K/M 收；
  精度选择器按最小步长 ×10 递进（BTC 0.01 → 0.1 → 1 → 10），合并时卖价上取整、买价下取整；
  深度条两侧都**贴右边**生长，宽度按两侧共用分母算、超长截到 100%；底部是买卖挂单金额占比条。
  样式仍用本页终端配色，不照搬币安皮肤。
- **盘口的两组控制项**（同样按币安实测的形状做）：表头工具行左侧三个模式图标 Both / Bids only / Asks only
  （选中 opacity 1、未选中 0.4；单侧模式把另一侧整列 `hidden`，留下的一侧自然撑满整栏）；
  窗格标题右侧 `⋯` 菜单（`BookMenu`，走 `Pane` 的 `tools` 槽）里 5 项：Display Avg.&Sum（每侧底部一行
  `AVG … / Σ …`）、Show Buy/Sell Ratio、Rounding（**开 = 紧凑 K/M，关 = 完整数值带千分位**，实测是反直觉的
  那一侧）、Book Depth Visualization 的 Amount / Cumulative（**只改深度条口径**，从最优价往外累加、最深处满格，
  Total 列不变）、Animations（条宽 0.3s 过渡）。视图开关都在页面里按语句 `bindSignal`，再逐个作为 props 传下来。
- **盘口档数按容器实测高度算**（`bookRowCount`）：每侧 216px 就渲染 12 档，拖动分栏、切单侧都会跟着重算——
  以前固定 18/38 档，面板高时留白、矮时白渲染。`watchSize` 写在每侧列表的 `plugin` 上，取两侧较大者
  （隐藏那侧 `clientHeight` 为 0）。
- **点盘口某一档 → 填 Paper order 的限价**：`onPickPrice` 把价格写进页面的 `limitPrice` 信号，`Ticket` 优先用它
  算金额/数量（点 `×` 恢复跟随最新价）；切币对时清空。
- **K 线视口 = 可见根数 + 距最新的偏移**（`chart-view.ts`）：滚轮以光标为锚点缩放（12~360 根，默认 90）、
  拖动平移（pointer capture，移出面板也能继续）、双击或 RESET 回最新；悬停吸附到 K 线中心画十字线，
  表头显示那根的 OHLC 与相对前一根的涨跌幅。价格刻度用 nice step 自动取并避开最新价标签，时间轴标签
  数量按面板宽度（约每 96px 一个）、跨日带日期且相邻重名只留一个；成交量占底部 18%。REST 一次拉 500 根
  （`CHART_HISTORY`）供缩放用——只拉 120 根时缩到最小会露出空白。
- **深度图的 X 轴刻度按宽度收放**（`depthXTickCount`，约每 72px 一个，3~9 个），Y 轴刻度用 `formatCompact`
  （`19.57K`）而不是完整数字，否则 40px 的轴列放不下；tooltip 除 Price/Amount 外还给出累计**名义金额**
  （`SidePoint.notional`），和盘口 Total 同一口径。
- **演示免责声明**（`dashboard/legal.ooc` + `dashboard/notice.ts`）：页脚常驻一行
  `UNOFFICIAL DEMO · … · NOT INVESTMENT ADVICE`、标题栏常驻 `DEMO` 入口、首次进入自动弹一次
  （已读标记 `ooc-market-notice-v1` 存 localStorage，读写异常一律按「没读过」处理，宁可多弹一次）。
  文案覆盖：非交易所 / 与 Binance 无隶属与合作 / 无账户无 API Key 不会下单 / 行情可能延迟不构成投资建议 /
  再分发需合规且商用要授权 / 按现状无担保。**弹层不用 `createPop`**，就写成页面内的 `fixed` 节点
  靠 `visible` 切 `hidden`：portal 弹层不随 page 卸载，而在 destroy 里 close 会抛下面的错。
- **销毁钩子里禁止写「仍有订阅者」的信号**：`ctx addDestroy` 常在路由切页的**批次 listener 阶段**执行
  （`signalCache.onWorkBatch` 已置位），此时写状态会撞 `wy-helper` 的
  `Signal.didSet` 保护：`Uncaught Error: 计算期间不允许修改值`，而且会**打断后续 destroy 钩子**
  （表现为点左上角 logo 回首页时报错、自选行情连接泄漏）。行情会话的 `close` / `dispose` 因此
  一律不回写 status（`'offline'` 只剩类型兜底，没有生产者）；真需要展示态时，由调用方在事件回调
  或宏任务里写。同理 `createPop` 返回的 `close` 也不能在 destroy 里同步调用。

