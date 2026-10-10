# 05 模块

一个 `.ooc` 文件就是一个模块。文件的最后一条表达式就是它的导出值（通常是一个对象）。

## 定义模块

`math.ooc`：

```ooc
calc = { run(a, b) => a + b };
calc
```

## 导入

`main.ooc`：

```ooc
math = #import 'math.ooc';
math run 2 3    // 5
```

`#import` 使用相对路径。运行含模块的文件请用 `interpretPath` 配合 `NodeFileSystem`。

## 包引用（`@name`）

已安装的包通过 `.ooc_modules/<name>/` 目录解析（CLI `ooc install <目录|git-url>` 安装到该项目 `.ooc_modules/`）。引用时用 `@包名` 前缀：

```ooc
// base 是内置标准库包：'@base' → index.ooc 聚合导出；'@base/loop' → 子模块
loop = #import '@base/loop';
strings = #import '@base';
```

- `'@base'` 解析到包的入口（`ooc.json` 的 `entry` 字段，默认 `index.ooc`）
- `'@base/loop'` 解析到包的子模块 `loop.ooc`
- 包引用解析为虚拟路径 `/ooc-pkg/<name>/<file>`，由包感知的 FileSystemProvider 重定向到真实 `.ooc_modules` 目录
- 相对路径（`#import './loop'`、`#import 'loop'`）仍是默认风格，优先级低于 `/ooc-pkg` 包路径

## 类型的导入与导出

模块里声明的 `#type`、顶层赋值、导入绑定都是**命名导出**（`#import { ... }` 取用）；
模块**最后一条表达式是默认导出**（`x = #import '...'` 取用）。

### 默认导入（模块整体）

不加花括号时，导入模块的默认导出（最后一条表达式的结果）与全部类型：

```ooc
// geometry.ooc
Circle #type { kind(): 'circle', radius: number };
Box #type { width: number, height: number };
{ make(): Circle { { kind() { 'circle' }, radius() { 3 } } } }

// main.ooc
geom = #import 'geometry.ooc';
c: geom#Circle = geom make;
b: geom#Box = { width() { 10 }, height() { 20 } };
```

- 通过 `模块名#类型名`（命名空间形式）引用类型
- 泛型类型同样可以跨模块访问：`util#Box<number>`
- `模块名#方法名` 在类型位置取该方法的返回类型（用于注解）
- 类型也会平铺进当前文档（直接写 `Circle` 也能引用），但推荐用命名空间形式

### 命名导入（path 之前）

用 `#import { ... } '模块'` 显式导入目标模块的顶层声明，支持别名与多项目，
类型（`#type`）和值（顶层赋值、导入绑定）都可以导入：

```ooc
// geometry.ooc
Circle #type { kind(): 'circle', radius: number };
Box #type { width() : number, height(): number };
factory = { make(): Circle { { kind() { 'circle' }, radius() { 3 } } } };

// main.ooc：只导入需要的类型和值
#import { Circle, factory } 'geometry.ooc';
c: Circle = factory make;

// 多类型 + 别名
#import { Circle as C, Box } 'geometry.ooc';
c: C = factory make;
b: Box = { width() { 10 }, height() { 20 } };
```

### 类型导入（path 之后）

花括号放在 path 之后表示**只导入类型**（编译期 `import type`，**不加载、不执行**目标模块）：

```ooc
// 默认导入 + 类型导入
geom = #import 'geometry.ooc' { Circle as C };
c: C = geom make;
```

### 命名导入与类型导入可同时存在（分列 path 两侧）

```ooc
#import { factory } 'geometry.ooc' { Circle as C };
c: C = factory make;
```

- 命名导入（`named`）在 path 前，类型导入（`types`）在 path 后，二者互不排斥
- 导入不存在的导出/类型会产生 `typeNotFound` 诊断
- `as` 别名对命名导入、类型导入都生效
- 命名导入的值（顶层赋值等）直接取目标模块的对应导出（会执行目标模块）；类型导入则完全不执行

## 交给打包器：编译成纯 ES 模块

`ooc build <入口> -o <目录>` 把整棵 `.ooc` 依赖图编译成 TypeScript 模块（vite 项目则由
`vite-plugin-ooc` 在内存里做同一件事，无需中间产物）。产物与 TS import **完全等价**——
所有顶层声明都是 `export`，`#import` 编译成真 ES import，模块在导入时按依赖顺序自动执行：

```ooc
// lib.ooc
Point #type { x(): number };
scale = 2;
factory = { make() { { x() { 1 } } } };
factory
```

```ooc
// app.ooc
geom = #import './lib';
#import { scale, factory } './lib';
{ demo() { 0 } }
```

```ts
// lib.ts（生成）
export type Point = { x(): number }
export const scale = 2
export const factory = __createObject([...])
export default factory
```

```ts
// app.ts（生成）
import geom from './lib.ts'                       // 默认导入
import { scale, factory } from './lib.ts'          // 命名导入（值）
// 类型导入会合并成 import type { ... }
export default __createObject([...])               // 最后一条表达式
```

- 产物另有共享 `_ooc_runtime.ts`（`__send` / `__createObject`）与 `_ooc_globals.ts`
- **宿主 globals 是静态注入**：用到 `storage`/`dom` 等宿主名的模块会
  `import __globals from '_ooc_globals.ts'` 再从中取名，不再需要入口 `run(globals)` 传递。
  默认给空对象，`ooc build --globals <文件>`（或 `oocPlugin({ globals: '/src/bridge-globals.ts' })`）
  指向一个**默认导出 globals 对象**的模块即可
- 纯副作用导入（`#import './mod';` 不绑定任何名字）编译成 `import './mod.ts';`，模块必被执行
- `ooc compile <单文件>` 是另一套形态：自包含模块（内联运行时 + `__import` loader），适合单文件交付
