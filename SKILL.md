---
name: ooc
description: Skill for the Object Oriented C (OOC) project — a minimalist message-passing language built on Langium. Use when working on the OOC grammar, interpreter, type checker, LSP/VS Code extension, CLI, or docs in this repository.
---

# OOC (Object Oriented C)

OOC 是一门极简的消息传递语言：没有函数调用，只有「给对象发消息」。例如 `calc add 3 4`。它基于 Langium（语言工程框架），运行时把对象直接编译成原生 JS 对象。

## 仓库结构

| 目录 | 说明 |
| --- | --- |
| `packages/language` | 核心：Langium 语法、静态类型检查器、解释器、LSP 服务 |
| `packages/cli` | CLI：`interpret`（解释执行）与 `generate`（JS 生成，未实现） |
| `packages/extension` | VS Code 插件（LSP + hover + 语义高亮） |
| `packages/example` | 浏览器 demo（vite 打包，不在 Termux 兼容范围） |
| `docs/` | Rspress 文档站 |

## 构建与测试

```bash
npm run langium:generate   # 语法 → src/generated（已 gitignore，改动语法后必跑）
npm run build               # tsc -b + 各 workspace 构建
npm run test                # language 包：tsc 编译测试后跑 node --test（Node 内置，纯 JS，Termux/Android 可用）
```

测试跑在 **Node 内置的 node:test** 上：`test/compat.ts` 用 node:test + node:assert 复刻 vitest 的 describe/test/expect 小面 API。别换回 vitest——vitest 4 依赖 rolldown、vite 依赖 rollup，都要 dlopen 原生 `.node`，在 Android/Termux 的 linker namespace 下加载不了（esbuild 是子进程可执行文件，所以能用）。

例外：`packages/example` 用 vite 打包（不在 Termux 兼容范围），其 `vite build` 在本机无法运行；`npm run build`（root）因此会挂在 example，属预期。

`ooc.json`（`packages/language/src/diagnostics-config.ts`）类似 tsconfig，只控制**类型检查**的显示级别（off / warning / error），作用于 IDE/LSP 与 CLI `type-check` 指令，与运行无关。

## 架构要点

- **语法**：`packages/language/src/object-oriented-c.langium`。改语法后用 `langium:generate` 重新生成 AST。
- **运行时 = 原生 JS 对象**（`interpreter/runtime.ts`）：
  - `{ ... }` 编译为普通 JS 对象，方法用 `Object.defineProperty` 定义为函数。对象成员三种写法：`=` 常量绑定（`cached = 1+2`）——对象构造时求值**一次**，之后每次读取返回同一缓存值；`=> expr`（MethodAll 单行）与 `{ ... }` 方法体——**每次调用**都重新求值/执行。因此「跟随信号、事件」等动态属性必须写 `=>`，纯常量写 `=` 更省。
  - 继承用 JS 原型链 `Object.create(parent)`；`#guard` 不通过就沿原型链找下一个同名方法（guard 路由）。
  - 没有 `this`，只有 `responser`（最终接收消息的对象）与 `currentObject`（当前层对象）。
  - 消息派发顺序（`sendMessage`）：方法函数 → `methodNotFound` → JS 属性读/写 → `numDef` → `objectDefine` → `methodNotFound`。
- **类型注解纯装饰**：`type-checker.ts`（~1400 行）实现联合类型、字面量、可区分联合 guard 收窄、泛型实例化、上下文类型回填。**类型检查与运行是独立分支**：解释器（`interpreter/host.ts` 的 `createInterpretAction`）从不因类型诊断而中断，只拦语法错误；类型检查走 IDE/LSP 校验，或 `interpreter/host.ts` 的 `createTypeCheckAction`（CLI `type-check` 指令用）。
- **模块**：`.ooc` 文件最后一条表达式是导出值；`#import` 相对路径解析（`module-path.ts` 纯字符串实现，Node/浏览器一致）。
- **运算符无优先级**（左结合、同优先级），需要先算就加括号；`//` 是注释不是除法，除法用消息形式：`12 div 3`；`/` 是级联符。级联/管道可消括号：`(x at i)` 可写 `x/ at i`（`/` 是独立 token，无空格连写也合法）；管道 `v | f apply` 把 `v` 作为 `f` 的首参插入（thread-first），等价 `f apply v`——右侧必须是一条消息链，单消息要写 `| f apply`；`v | p -> 表达式`（NamedExpression）把 `v` 绑到参数 `p`。**级联 + 管道可以在同一个表达式里**（左嵌套：`x = a b/ c|f apply` ⇔ `f apply ((a b) c)`）。要小心的其实是「无括号实参」：实参列表按空格拆成多个 Primary，`text bind et value/ done|statusOf apply` 里 `et`、`value` 会被当成两个实参，`value` 变成裸标识符去作用域查找 → 报 `not found define for value`；应把整条管道表达式用括号包住作单个实参：`text bind (et value/ done|statusOf apply)`。
- **数组直接用 JS 生态**：`Array` 是 globalThis 全局对象，`(Array of)` 造普通数组（含空数组）；不可变改数据用数组原生 `toSpliced`：`arr / toSpliced 1 0 {...}`（返回新数组，旧数组不动）。playground 还有：`text bind <值/λ>` 派生文本（读到的信号一变就原地重写节点，适合纯文本派生）；列表级重建用区域组件 `forEach apply {...}`（内部走 Ctx.renderForEach，无需自取 ctx）；**受控输入**：`dom input value => 信号对象` —— 显示 `signal.get`、用户输入自动写回 `signal.set`，读当前输入直接 `signal get`，不再 `ui get '选择器'` 去 querySelector 强读（textarea/select 的 value、input 的 checked 同理）。
- **作用域**：`KVPair` 链式作用域；未定义标识符回退到 `globalThis`（浏览器/Node 通用），因此能裸用 `Math`、`Object`。

## 常用任务

- **改语法** → 编辑 `.langium` → `npm run langium:generate` → `npm run build` → `npm run test`
- **加内置运算符** → `library/num.ts` 或 `library/object.ts` 加方法，同步 `type-system.ts` 的 `builtinMethods` 签名
- **加诊断规则** → `type-checker.ts` 中 `accept('warning', ..., data: diagnosticData(code))`，code 注册进 `diagnostics-config.ts` 的 `DIAGNOSTIC_CODES`
- **跑类型检查** → IDE 里由 LSP 实时校验；命令行用 `ooc type-check <file>`（返回诊断，有 error 级则 exit 1）
- **浏览器运行** → 用 `EmptyFileSystem`；Node 读文件/`#import` 用 `NodeFileSystem`。宿主桥接对象 `storage`（可变 cell）、`loop`（`apply`=lambda 返回真值就继续的 while、`repeat`=恰好 n 次）、`js`（`throw` 抛错 / `new` 实例化 JS 类 / `fn` 把 OOC lambda 包装成真 JS 函数）由语言包导出（`interpreter/bridges.ts`），浏览器 demo（`main.ts`）与 `test/examples.test.ts` 共用同一份。`console`、`Math` 等 JS 全局走 `globalThis` 回退，无需注入。宿主侧调用 lambda 用语言包公开的 `invoke`（lambda 是带 apply 方法的 ObjectValue，不是裸 JS 函数）。

## 注意

- **除法键只有 `div`**（`12 div 3`）；`'/'` 已从 number 方法表移除（`/` 是级联符），`//` 是单行注释（`SL_COMMENT`），`MessageInfixRight` 不再声明 `'//'` 中缀。
- **事件属性必须 `=>`**：`=` 在对象构造时求值一次，事件写成 `onClick = ...` 会永远用构造时的值（比如空 input）；跟随信号、需要每次取值的属性同理。
- **信号要感知变化需新引用**：改数组要 `xs / toSpliced ...` 返回新数组再 `list set`；原地 `push`/`splice` 不会触发重渲染。
- **单参数 λ 应用可提前做管道**：`et index|remove apply` ⇔ `remove apply (et index)`。
- 测试/构建的 toolchain 必须能用纯 JS（或 esbuild 这种子进程可执行文件）跑：任何 dlopen 原生 `.node` 的库（vitest4/rolldown、vite/rollup、SWC 等）在 Android/Termux 都不可用，别引入。
- 本项目使用了 `.agents/skills/langium/SKILL.md`（由 `skills-lock.json` 记录的已安装 Langium skill），涉及 Langium 机制细节时阅读它。
