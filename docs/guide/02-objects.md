# 02 对象与方法

## 定义对象

```ooc
calc = {
    add(a, b) => a + b,      // 单表达式方法
    sub(a, b) { a - b },     // 方法体，最后一行是返回值
    cached = 1 + 2,          // 计算绑定：惰性求值，首次读取时算一次并缓存
    lazy = @{                // 多语句绑定块：用 @{ 引导（与对象字面量 { } 区分）
        a = 1,
        b = 2,
        a + b               // 最后一条是值
    }
};
```

## 绑定与多语句块

`name = 表达式`：**纯字面量**（str/num/bool/nil）在构造期直接写值；**计算式**是惰性绑定——首次读取这个名字时求值，结果缓存，之后再读不重算。所以绑定可以引用后面才定义的成员，也只会算一次。

需要多条语句时，用 `@{ ... }` 块（块内可用分号分隔多条语句、局部赋值，最后一条是值）：

```ooc
config = {
    base = 10,
    area = @{
        r = this radius;
        r * r * 3.14
    },
    radius => base div 5
};
config area        // → 12.56
```

`@{` 引导是必需的——`name = { ... }` 只能解析为对象字面量，两者不混。

## 成员形状：绑定与方法

成员按形状分流（消息写法不变，都是空格发消息）：

- **常量绑定 `name = 值`**：**纯字面量**（str/num/bool/nil）编译成数据属性——构造期写值一次，`obj name` 恒定返回；**计算式**（含 `@{ }` 块）是惰性 getter——首次读取求值一次并缓存，之后不重算。绑定可以引用后面才定义的成员。绑定是**只读**的：`obj name x` 不会改写它（可变状态用宿主容器）。
- **方法 `name(...) => ...` / `name(...) { ... }`**：编译成带内部标记的数据函数，**每次发消息时执行**。零参成员（`kind { shapeName }`、`radius => side * 2`）同样是方法——`obj radius` 发消息才执行；事件/跟随信号用 `=>`，每次读取重算。

**纯字面量常量必须直接写绑定**（`kind = 'circle'`）：写成 `{ 'circle' }` / `=> 'circle'` 会被 validator 以 `constMethodBody` 报错——字面量恒定，绑定一次写值更省。

方法体返回 lambda 时，读取（发消息）拿到 lambda 本体（不会被隐式执行），要调用再显式 `apply`：

```ooc
obj = { handler => [x => x + 1] };
h = obj handler;      // 发消息执行方法体，h 是返回的 lambda 本体
h apply 41            // 42
```

JS 侧对应形状：字面量绑定是数据属性（`.x` 直读值），计算绑定是 getter（`.x` 读取即求值、函数值原样返回），方法是函数（`.f(args)` 调用；零参方法 `.m()` 调用才执行）。

## 转发属性

`name <= delegate` 把**名字上的所有消息**原样转发给 `delegate` 的 `apply` 方法执行（消息名不传给 apply，只传实参）：

```ooc
double = { apply(v) => v * 2 };
box = { value <= double };

box value 21     // 42（→ double apply 21）
box value        // undefined（→ double apply，无参）
box value 1 2    // 会按 apply 的形参匹配（这里 apply 只有 1 参，运行时抛「没有定义该方法」）
```

- 委托对象必须含 `apply`（像 lambda 或可调用对象）；没有时类型检查会报错。
- 名字唯一：`<=` 转发与同名 `=` / 方法体不能共存（重复定义报 `duplicateMethod`）。
- 实例/模块级可变状态不靠属性写入，改用宿主容器（`storage ref`、signal、数组等）。

## this

方法体内 `this` 指向触发消息的对象（receiver）：

```ooc
calc = {
    cached = 5,
    inc(n) { this cached + n }
};
calc inc 3       // 8
```

## 剩余参数

```ooc
obj = { apply(a, ...rest) { rest } };
obj apply 1 2 3 4    // [2, 3, 4]
```

## 守卫 #guard

方法体用 `#guard` 分支链组织，就是 if / else-if / else：逐条 `#guard 条件; 语句`，条件为真就执行该段并返回；全不命中落入 `#else; 语句`（无 `#else` 返回 nil）。`#guard` 不参与消息派发——一个名字只有一个成员，没有同名重载。`#guard` 之前的语句**先执行**（赋值进作用域、表达式求值），之后才进入分支判别——条件与分支都能引用它们。

```ooc
f = {
    r(a) {
        #guard a > 5;
        'big'
        #guard a < 0;
        'neg'
        #else;
        'small'
    }
};
f r 9    // 'big'
f r 2    // 'small'
f r -1   // 'neg'
```

`#guard` 前的语句对条件与分支可见：

```ooc
g = {
    r(a) {
        t = a * 2;
        #guard t > 10;
        t + 1
        #else;
        t
    }
};
g r 8    // 17（t = 16，条件成立）
g r 3    // 6（t = 6，落入 else）
```

## 签名方法（TS 式签名类型标注）

方法可以不写 body：**签名方法**只在类型层声明「参数类型 → 返回类型」，运行时是纯契约（不烧录任何行为，调用点按签名做参数化分派）：

```ooc
calc = {
    area(radius: number): number;   // 签名
    area(radius: string): string;   // 签名
    area(r) {                       // 实现（运行时按名字落到唯一实现）
        r
    }
};
```

- 调用点按签名推断返回类型：`calc area 3` → `number`，`calc area 'x'` → `string`。
- 签名方法之间返回类型不同**不告警**（TS 式豁免）；实现方法体与声明不符才告警。
- **签名方法必须有返回类型**（既无 body 又无返回类型会报错）；**无参方法不写括号**（`f()` 是语法错误，写 `f` 即可）。

## 委托组合 withDefault

OOC **没有继承**（没有 `{ ...base }` 原型合并）。复用与兜底交给 `withDefault` 委托（宿主端 `delegate` 全局）：spec 的方法优先，未知消息按 defaults 顺序查找。

```ooc
defaults = { speak = 'voice', bark = 'wang' };
spec = { fly = 'fly' };
w = delegate withDefault spec defaults;

w fly      // 'fly'（spec 自有）
w speak    // 'voice'（转给 defaults）
```

spec 与 defaults 同名时 spec 优先：

```ooc
spec2 = { speak = 'wang' };
w2 = delegate withDefault spec2 defaults;
w2 speak   // 'wang'
```

`withDefault` 的产物也是包装对象，可以再次拼进新链（`e = delegate withDefault c d`），
已组合的链在组装期展平，原对象（spec/defaults）只读不写，可被多个包装安全共享。

## 嵌套对象

```ooc
outer = { inner = { value = 42 } };
outer inner / value    // 42
```

`outer inner` 取到 inner 对象，`/ value` 继续给它发消息。
