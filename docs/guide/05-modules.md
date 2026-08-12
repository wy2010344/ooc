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

## 类型即值：模块导出对象的类型成员

模块里声明的 `#type` 会作为**类型成员**挂在导出对象上，导入方通过 `模块名#类型名` 访问（命名空间形式）：

```ooc
// geometry.ooc
Circle #type { kind(): 'circle', radius: number };
{ make(): Circle { { kind() { 'circle' }, radius() { 3 } } } }

// main.ooc
geom = #import 'geometry.ooc';
c: geom#Circle = geom make;
```

- 导出对象直接携带类型成员，不需要额外包装层
- 泛型类型同样可以跨模块访问：`util#Box<number>`
- `模块名#方法名` 在类型位置取该方法的返回类型（用于注解）
- 为了兼容，导入模块的 typedef 也会平铺进当前文档（直接写 `Circle` 也能引用），但推荐用命名空间形式
