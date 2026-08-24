# Object Oriented C (OOC)

一门极简的消息传递语言：没有函数调用，只有「给对象发消息」。

```ooc
calc = {
    add(a, b) => a + b,
    cached = 1 + 2
};
calc add 3 4     // 7
calc cached      // 3
```

## 运行

在 JS / TS 中运行代码：

```ts
import { createInterpretAction } from 'object-oriented-c-language'
import { EmptyFileSystem } from 'langium'

const ooc = createInterpretAction(EmptyFileSystem)
await ooc.interpret(`'hello' + ' world'`)   // 'hello world'
```

运行 `.ooc` 文件（含 `#import` 模块）请用 `NodeFileSystem`：

```ts
import { NodeFileSystem } from 'langium/node'

const ooc = createInterpretAction(NodeFileSystem)
await ooc.interpretPath('src/main.ooc')
```

- `interpret(code)`：执行一段代码，返回最后一条表达式的值
- `interpretPath(file)`：执行一个 `.ooc` 文件

解释器不绑定具体文件系统，按运行场合注入：内存执行用 `EmptyFileSystem`，Node 环境读写文件用 `NodeFileSystem`。

## 类型检查与运行是两个独立分支

类型注解纯装饰，解释器**从不因类型诊断而中断**（语法错误除外）。类型检查只发生在两处：

- **IDE / 编辑器**：VS Code 插件通过 LSP 实时校验，`ooc.json`（类似 tsconfig）控制每条规则的显示级别（off / warning / error）
- **独立指令**：`ooc type-check <file>` 静态检查并打印诊断，有 error 级诊断时以非零退出码结束（适合 CI）

## 三个最容易踩的坑

- `//` 是注释，**不是**除法；除法用 `/`：`12 / 3`（中缀运算符，优先级与加减相同）
- 字符串只能用单引号：`'hi'`
- 调用方法用空格，不用括号：`calc add 3 4`，不是 `calc.add(3, 4)`
- JS 对象的属性直接访问：`'abcdef' length`（6）；带参数则写入属性：`Math _answer 42`

## 文档

在线文档站（Rspress）：<https://wy2010344.github.io/ooc/>

- [01 基础语法](docs/guide/01-basics.md) —— 变量、类型、运算符、消息
- [02 对象与方法](docs/guide/02-objects.md) —— 对象、responser、守卫、继承
- [03 管道](docs/guide/03-pipeline.md) —— `/` 与 `|`
- [04 类型注解](docs/guide/04-types.md) —— `:`、`#type`、联合类型
- [05 模块](docs/guide/05-modules.md) —— `#import`
- [06 Lambda](docs/guide/06-lambda.md) —— `[...]` 匿名函数

本地开发文档站：

```bash
cd docs
npm install
npm run dev
```
