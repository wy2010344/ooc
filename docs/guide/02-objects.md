# 02 对象与方法

## 定义对象

```ooc
calc = {
    add(a, b) => a + b,      // 单表达式方法
    sub(a, b) { a - b },     // 方法体，最后一行是返回值
    cached = 1 + 2           // 绑定：创建时求值一次，之后发消息取缓存（也是方法）
};
```

## 转发属性

`name <= delegate` 把**名字上的所有消息**原样转发给 `delegate` 的 `apply` 方法执行（消息名不传给 apply，只传实参）：

```ooc
double = { apply(v) => v * 2 };
box = { value <= double };

box value 21     // 42（→ double apply 21）
box value        // undefined（→ double apply，无参）
box value 1 2    // 会按 apply 的形参匹配（这里 apply 只有 1 参，运行时报 methodNotFound）
```

- 委托对象必须含 `apply`（像 lambda 或可调用对象）；没有时类型检查会报错。
- 可与同名普通方法共存，但转发优先：消息一律走 `apply`。
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

方法体以 `#guard` 开头时，条件不满足则该方法不执行，会继续找同名的下一条方法。

守卫的分派规则：

- **`#guard` 只用在同名重载组里**（≥2 条带 body 的同名方法）。单条方法带 guard 会报 `guardOnlyInOverload`。
- 重载组末尾分支是**无条件兜底**，落入即执行，不能带 guard（报 `guardOnTrailingBranch`）。
- 前面若干分支各自带 guard，条件满足即命中，全部不满足则落入末尾兜底。
- 同名重载分支必须**相邻定义**（中间不能夹别的名字，报 `overloadNotAdjacent`）。

```ooc
f = {
    r(a) { #guard a > 5; 'big' },   // 守卫分支
    r(a) { #guard a < 0; 'neg' },   // 守卫分支
    r(a) { 'small' }                // 末尾兜底
};
f r 9    // 'big'
f r 2    // 'small'
f r -1   // 'neg'
```

## 签名方法（TS 式重载类型标注）

方法可以不写 body：**签名方法**只在类型层声明「参数类型 → 返回类型」，运行时是纯契约（不烧录任何行为，配合实现方法做参数化重载）：

```ooc
calc = {
    area(radius: number): number;   // 签名
    area(radius: string): string;   // 签名
    area(r) {                       // 实现（无签名，运行时按签名分派后落入）
        r
    }
};
```

- 调用点按签名推断返回类型：`calc area 3` → `number`，`calc area 'x'` → `string`。
- 签名方法之间返回类型不同**不告警**（TS 式豁免）；实现方法体与声明不符才告警。
- **签名方法必须有返回类型**（`f()` 这种既无 body 又无返回类型的写法会报错）。

## 委托组合 withDefault

OOC **没有继承**（没有 `{ ...base }` 原型合并）。复用与兜底交给 `withDefault` 委托（base 包 `delegate`）：spec 的方法优先，未知消息按 defaults 顺序查找。

```ooc
delegate = #import 'delegate';
defaults = { speak() => 'voice', bark() => 'wang' };
spec = { fly() => 'fly' };
w = delegate withDefault spec defaults;

w fly      // 'fly'（spec 自有）
w speak    // 'voice'（转给 defaults）
```

spec 与 defaults 同名时 spec 优先：

```ooc
spec2 = { speak() => 'wang' };
w2 = delegate withDefault spec2 defaults;
w2 speak   // 'wang'
```

## 嵌套对象

```ooc
outer = { inner = { value = 42 } };
outer inner / value    // 42
```

`outer inner` 取到 inner 对象，`/ value` 继续给它发消息。
