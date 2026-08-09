# 02 对象与方法

## 定义对象

```ooc
calc = {
    add(a, b) => a + b,      // 单表达式方法
    sub(a, b) { a - b },     // 方法体，最后一行是返回值
    cached = 1 + 2           // 绑定：创建时计算一次，之后直接取缓存
};
```

## 调用

```ooc
calc add 3 4     // 7
calc cached      // 3
```

## this

方法内的 `this` 指向对象自己，用来访问自己的方法 / 绑定：

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

方法体以 `#guard` 开头时，条件不满足则该方法不执行，会继续找下一个同名方法：

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

## 嵌套对象

```ooc
outer = { inner = { value = 42 } };
outer inner / value    // 42
```

`outer inner` 取到 inner 对象，`/ value` 继续给它发消息。
