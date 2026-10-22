# Object Oriented C (OOC)

**一门「只会发消息」的极简语言，和一整套真能用的工具链**：解析器 / 解释器 / 类型检查 / LSP / 代码生成 / Vite 插件 / 浏览器运行时。

[![CI](https://github.com/wy2010344/ooc/actions/workflows/ci.yml/badge.svg)](https://github.com/wy2010344/ooc/actions/workflows/ci.yml)
[![Deploy](https://github.com/wy2010344/ooc/actions/workflows/deploy.yml/badge.svg)](https://wy2010344.github.io/ooc/)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**▶ [在线 Playground](https://wy2010344.github.io/ooc/playground/)** ｜ **[行情终端 Demo](https://wy2010344.github.io/ooc/example/#/dashboard)** ｜ [文档](https://wy2010344.github.io/ooc/) ｜ [设计取舍](DESIGN.md)

![行情终端：K 线 / 盘口 / 深度图 / 可拖拽分栏](docs/public/demo-terminal.gif)

> 这个行情终端（K 线缩放拖动、盘口增量同步、深度图、三栏拖拽）**界面代码全部用 OOC 写**，
> 数据接币安公开行情，无 API Key。它存在的意义只有一个：证明这门语言能扛住真实界面。

## 这是什么

没有函数调用，只有「给对象发消息」：

```ooc
calc = {
    add(a, b) => a + b,
    cached = 1 + 2
};
calc add 3 4;     // 7
calc cached;      // 3
```

`calc add 3 4` = 给 `calc` 发 `add` 消息，载荷 `[3, 4]`。**语句之间必须用 `;` 分隔**——换行只是空白，
少了 `;` 两条语句会被并成一条消息链（本项目最常见的坑，见 [DESIGN.md](DESIGN.md) §13）。循环、抛错、类型判别也都是消息
（`loop $`、`js throw`、`#guard`），不给语言开语法洞。没有继承——复用靠 `merge` 委托；
运行时类型靠 `#guard` 执法，静态类型只做导航（soft typing），**从不因类型诊断中断执行**。

## 跑起来

```bash
git clone https://github.com/wy2010344/ooc && cd ooc && npm install

npm run dev -w packages/playground     # 在线记事本（笔记存 IndexedDB）
npm run dev -w packages/example        # 示例站，行情终端在 #/dashboard
node packages/cli/bin/cli.js type-check 某个文件.ooc
```

作为库嵌入（仓库内 workspace 直接引用源码）：

```ts
import { createInterpretAction } from 'object-oriented-c-language'
import { NodeFileSystem } from 'langium/node'

const ooc = createInterpretAction(NodeFileSystem)
await ooc.interpret(`'hello' + ' world'`)   // 'hello world'
await ooc.interpretPath('src/main.ooc')     // 执行整个文件（支持 #import）
```

解释器不绑文件系统：内存执行注入 `EmptyFileSystem`，Node 读写文件注入 `NodeFileSystem`。

## 工具链

| 包 | 做什么 | 规模 |
| --- | --- | --- |
| `packages/language` | Langium 语法 → 解释器 → 类型检查 → LSP（补全 / 悬停 / 诊断 / 跳转） | 438 tests |
| `packages/cli` | `ooc type-check`；把 `.ooc` 编译成 TS / ES 模块（含共享运行时） | 29 tests |
| `packages/extension` | VS Code 扩展：LSP 客户端 + 语法高亮 | — |
| `packages/vite-plugin-ooc` | 让 `.ooc` 像 `.vue` 一样被 `import`，无磁盘中间产物 | — |
| `packages/ooc-mve-bridge` | OOC 侧的 DOM / 组件桥（`dom` `text` `fc` `forEach` + 信号） | — |
| `packages/playground` | 在线记事本：点「运行」看结果，笔记天然是 `.ooc` 模块 | — |
| `packages/example` | 示例站：组件库（shadcn 风格）+ 行情终端 | — |

## 语言速览

| | 写法 |
| --- | --- |
| 发消息 | `calc add 3 4`（不是 `calc.add(3, 4)`） |
| 除法 / 注释 | `12 div 3`（`div` 是普通消息）；`//` 是注释，`/` 是级联 |
| 运算优先级 | **没有优先级，左结合**：`1 + 2 * 3` = 9，要提前算就加括号 |
| Lambda | `[x => x + 1]` |
| 分支 | `#guard cond; a #else; b` |
| 联合类型 | `Circle \| Square`，`#guard` 逐条判别 |
| 委托 / 兜底 | `merge $ 子对象 默认值` |
| 模块 / 管道 | `#import { x } './m.ooc'`；`v \| add call 5` |

## 状态

- **467 个测试**（438 language + 29 cli），GitHub Actions 每次 push 都跑一遍
- **文档示例可校验**：README 与本指南里的 ```ooc 代码块由 `npm run test:docs` 抽出来跑同一套类型检查，
  示例「复制就能跑」是 CI 保证的，不是口头承诺
- 文档站 <https://wy2010344.github.io/ooc/>（Rspress，含语法高亮与示例）
- 设计取舍见 [DESIGN.md](DESIGN.md)，改动约定与踩坑记录见 [AGENTS.md](AGENTS.md)

## License

[MIT](LICENSE)
