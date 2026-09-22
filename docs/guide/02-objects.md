# 02 对象与方法

## 定义对象

```ooc
calc = {
    add(a, b) => a + b,      // 单表达式方法
    sub(a, b) { a - b },     // 方法体，最后一行是返回值
    cached = 1 + 2,          // 绑定：创建时求值一次，之后发消息取缓存（也是方法）
    counter <= 0             // 可变属性：无参返回当前值，有参修改并返回新值
};
```

## 调用

```ooc
calc add 3 4     // 7
calc cached      // 3
calc counter     // 0（无参 → 返回当前值）
calc counter 42  // 42（有参 → 修改并返回新值）
calc counter     // 42（已修改）
```

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

方法体以 `#guard` 开头时，条件不满足则该方法不执行，会继续找下一条同名方法（同一对象内；全部不满足则 `methodNotFound`）：

```ooc
f = {
    r(a) { #guard a > 5; 'big' },
    r(a) { 'small' }
};
f r 9    // 'big'
f r 2    // 'small'
```

## 签名方法（TS 式重载类型标注）

方法可以不写 body：**签名方法**只在类型层声明「参数类型 → 返回类型」，运行时是纯契约（不烧录任何行为，配合实现方法做参数化重载）：

```ooc
calc = {
    area(radius: number): number;   // 签名
    area(radius: string): string;   // 签名
    area(r) {                       // 实现（无签名，运行时靠它 + #guard）
        #guard (r length) != nil;
        1
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
