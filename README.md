Object Oriented C (OOC)

这是基于 Langium 的一门小型面向对象风格的消息传递语言文档，文档内容根据当前语法 `object-oriented-c.langium` 和解释器 `packages/language/src/interpreter.ts` 编写。

核心设计要点：

- 语言没有传统的函数调用模型，主要以“对象定义 + 向对象发送消息（message）”为中心。
- 顶层由若干语句组成：赋值、导入、异常捕获或表达式；最终表达式的值可作为模块执行结果。

主要语法概览

- 赋值
  - 顶层与方法内部使用简单赋值：`name = Expression`。
  - 示例：`x = 42;`

- 导入
  - 导入语句格式：`mod = #import 'path'`（path 使用单引号字符串）。
  - 解释器会按需解析导入的文件并把返回值绑定到左侧标识符。

- 异常捕获赋值
  - 语法：`errVar, resultVar = Expression`。
  - 语义：尝试求值 Expression；若成功，`errVar` 绑定 `null`，`resultVar` 绑定值；若抛错，`errVar` 绑定异常对象，`resultVar` 绑定 `null`。

- 对象定义
  - 对象采用花括号定义，内部为若干方法（逗号分隔）：
    - 普通方法：`name(params...) { ... }`，方法体多语句，最后一条语句的值作为返回值。
    - 单表达式方法（简写）：`name(params...) => Expression`。
    - 绑定方法（在对象创建时求值并缓存）：`name = Expression`（在解释器中称为 `MethodBind`，首次计算并缓存结果）。
  - 示例：
    abc = {
    add(a,b) { a add b },
    info => 'fixed',
    cached = 1 add 2
    };

- 消息（方法）发送与链式/流水线
  - 基本消息形式：`receiver messageName arg1 arg2 ...`，messageName 为普通标识符或属性（以 `#` 开头）。
  - 管道 `/`：将当前表达式的结果作为接下来消息调用的“接收者/第一个参数”（表现为连续发送消息）。
    - 示例：`'abc' slice 1 3 / slice 1 2`（将结果继续送入后续消息）。
  - 管道 `|`：把左侧的值注入到右侧表达式中，右侧可为普通消息链或“命名占位”表达式 `name => expr`，命名占位会把左值绑定为 `name` 并在右侧表达式中使用。
    - 示例：`'abcdef' length | 1 add` 把 `'abcdef' length` 的结果作为 `1 add` 的第一个参数。
    - 命名占位示例：`v | x . 1 add x` 表示把 `v` 绑定为 `x` 用于右侧表达式。

- 属性访问（MethodProperty）
  - 消息名可以是以 `#` 开头的标识符（`PropertyID`），用于访问/设置对象或扩展对象的属性（例如与 JS 互操作时使用）。

基本类型

- 数字：词法为整数或小数。
- 布尔：`true` / `false`。
- 字符串：使用单引号 `'like this'`。
- StID：以双引号开始的标识（语义上由解释器进一步处理，常用于 JS 属性等场景）。
- 空值：`nil`（对应解释器中的 `null`）。

对象与作用域

- 对象没有字段概念（对象由方法集合组成），共享数据应放在外层闭包（通过外层作用域捕获）。
- 对象创建时会带上定义时的作用域；方法执行时会自动注入 `this`、`args`、`methodName` 以及参数变量。

内置与扩展语义

- 数字与布尔有内置扩展方法（例如 `add`, `sub`, `mul`, `div`, `mod`, `eq`, `lt` 等；布尔有 `and`, `or`, `not`）。
- 发送消息时：如果接收者是自定义 `ObjectValue`，消息会查找该对象的相应方法并调用；否则，会尝试把消息名当作 JS 属性/方法调用。

异常与控制流

- 语言通过异常捕获赋值（`err, val = expr`）在表达式级别处理异常。
- 解释器中还可以通过宏/内置控制结构扩展（例如项目中可能存在的 `#if`, `#while`, `#return` 等扩展——这些为宏层面功能，视实现而定）。

示例

1. 基本赋值与对象

```
num = 10;
obj = {
  inc(x) { x add 1 },
  value => 42,
  cached = 1 add 2
};

res = obj inc 5; // 调用 obj 的 inc 方法，返回 6
```

2. 管道与命名占位

```
'abcdef' length | 1 add
v = 'abc' slice 1 2 / length

// 命名占位
val | x . 1 add x
```

3. 异常捕获赋值

```
err, result = riskyOperation;
// 成功时 err 为 null，result 为值；失败时 err 为异常对象，result 为 null
```

解释器使用（开发者说明）

- 解释器入口在 `packages/language/src/interpreter.ts`，导出 `createInterpretAction(context)`，返回对象包含：
  - `interpretPath(filePath)`：按文件路径解析并执行模块，返回执行结果（支持导入缓存与按需解析）。
  - `interpret(txt, fileName?)`：解析字符串并执行（用于测试或内存执行）。
- 解释器实现要点：对象的 `MethodBind` 在对象创建时被求值并缓存；`MethodAll` 在调用时新建作用域并顺序执行方法体内语句；管道和命名占位在解释器中有明确实现，保证表达式组合的灵活性。
