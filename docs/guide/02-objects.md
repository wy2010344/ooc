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

## responser

方法体内**没有 `this`**。需要访问触发消息的对象时用 `responser`：它始终指向最终收到消息的对象（继承时是子对象，不是定义方法的那一层）：

```ooc
calc = {
    cached = 5,
    inc(n) { responser cached + n }
};
calc inc 3       // 8
```

## 剩余参数

```ooc
obj = { apply(a, ...rest) { rest } };
obj apply 1 2 3 4    // [2, 3, 4]
```

## 守卫 #guard

方法体以 `#guard` 开头时，条件不满足则该方法不执行，会继续找下一个同名方法（同一对象内，或继承链上的父对象）：

```ooc
f = {
    r(a) { #guard a > 5; 'big' },
    r(a) { 'small' }
};
f r 9    // 'big'
f r 2    // 'small'
```

## 继承

```ooc
animal = { speak() => 'voice' };
dog = { ...animal, bark() => 'wang' };

dog speak    // 'voice'（继承父方法）
dog bark     // 'wang'（自己的方法）
```

同名方法会覆盖父方法：

```ooc
dog = { ...animal, speak() => 'wang' };
dog speak    // 'wang'
```

子方法 guard 不通过时，会继续向上找父对象的同名方法：

```ooc
base = { r(a) { #guard a > 10; 'big' } };
child = { ...base, r(a) { #guard a < 5; 'small' } };
child r 12    // 'big'（子 guard 不过，父 guard 过）
```

## 嵌套对象

```ooc
outer = { inner = { value = 42 } };
outer inner |> value    // 42
```

`outer inner` 取到 inner 对象，`|> value` 继续给它发消息。
