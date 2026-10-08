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

模块里声明的 `#type` 自动导出，导入方可以选择性地引入需要的类型。

### 全量导入（向后兼容）

不加花括号时，导入模块的所有类型和值：

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

### 选择性导入

使用花括号 `{}` 显式指定要导入的类型，支持别名和多类型：

```ooc
// main.ooc
geom = #import 'geometry.ooc' { Circle };
c: geom#Circle = geom make;
// Box 不可见，会产生诊断告警
```

```ooc
// 多类型 + 别名
geom = #import 'geometry.ooc' { Circle as C, Box };
c: geom#C = geom make;
b: geom#Box = { width() { 10 }, height() { 20 } };
```

- 花括号内的类型名不可用会产生 `typeNotFound` 诊断
- 选择性导入只影响**类型成员**，运行时仍导入整个模块的值
