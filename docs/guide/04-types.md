# 04 类型注解

类型注解只做编辑器 / 诊断提示，**不影响运行**。

## 变量注解

```ooc
x: Number = 42
greet: string = 'hi'
```

## 类型别名 `#type`

```ooc
Animal #type { speak(): string };
```

## 联合类型

```ooc
Value: Number | string
```

## 字面量类型与可区分联合

字面量类型（`'circle'` / `42` / `true`）是 TS 风格可区分联合的基础：对象类型的判别方法可以声明返回字面量，联合成员按判别收窄。

```ooc
Circle #type { kind(): 'circle', radius: number };
Square #type { kind(): 'square', side: number };

// 字面量可以直接注解变量
shape: 'circle' | 'square' = 'circle'

// 用 guard 判别收窄：guard 通过后 s 的类型自动收窄为对应成员
area = {
    calc(s: Circle | Square) {
        #guard (s kind) == 'circle';
        (s radius) * (s radius) * 3.14    // 这里 s 已是 Circle，可直接访问 radius
    },
    calc(s: Circle | Square) {
        #guard (s kind) == 'square';
        (s side) * (s side)               // 这里 s 已是 Square
    }
};
area calc { kind() { 'circle' }, radius() { 3 } }   // 28.26
```

- 判别测试支持 `==` 与 `!=`（`#guard (s kind) != 'circle'` 收窄为其余成员）
- 未判别就调用成员专属方法会警告：`消息 'radius' 只定义在部分联合成员上（Circle），Square 上没有，需要先判别`
- 联合的公共方法（如 `kind`）可直接调用，无需判别
- 字面量是基础类型的子类型：`'circle'` 可赋给 `string`，`42` 可赋给 `number`

## 泛型

`#type` 别名可以声明类型参数，实例化时替换：

```ooc
Box #type<T> { get(): T, set(x: T) };

b: Box<number> = { get() { 42 }, set(x) { x } };
b get    // 42
```

- 声明用 `Name<T>`，多参数用 `Name<A, B>`；body 里的 `T` 是占位，实例化时替换
- 实例化支持嵌套与联合：`Pair<Box<number>, string>`、`Shape<Circle | Square>`
- 缺少类型参数、参数个数不匹配、给非泛型类型传参数都会警告，并按 `any` 处理（不影响运行）
- 实例化后的类型照常做子类型检查：`Box<number>` 会检查 `get` 返回 `number`，`set` 参数为 `number`

### 方法级泛型

对象字面量方法（含 lambda 回调）和 `#type` 的方法签名都可以声明自己的类型参数 `<T>`，调用时从实参推断：

```ooc
list = {
    map<T>(f: T): T { f }        // 调用 map 42 时 T 推断为 number
};
r: number = list map 42

// #type 方法签名同样支持
Container #type { wrap<T>(x: T): T };
c: Container = { wrap(x) { x } };
s: string = c wrap 42            // 警告：推断出 T=number，赋给 string
```

- 方法泛型参数只在方法签名内可见，方法体内可用（`y: T = x`）
- 参数里的嵌套泛型会从实参对象反推：`make<T>(b: Box<T>): T` 传入 `{ value() { 42 } }` 时，从 `Box<T>` 的 `value(): T` 与实参的 `value(): number` 反推 `T=number`
- 推断不出的占位按 `any` 处理（"未声明又不能推断，退回 any"），不误报
- 泛型 typedef 实例化后，其上的方法级泛型签名保留，可继续独立推断

## 上下文类型回填

有注解的赋值会把声明类型带回对象字面量方法体：**无注解参数按声明签名自动回填**，方法体内部不用重复标注。

```ooc
Box #type<T> { get(): T, set(x: T) };

// set(x) 的参数 x 自动回填为 number，方法体内可直接运算
b: Box<number> = { get() { 42 }, set(x) { x + 1 } }
```

- 显式参数注解优先于回填；回填后参数照常参与重新赋值、方法调用等类型检查
- 无注解的对象（如 `b = { set(x) {...} }`）没有上下文，参数保持 `any` 不检查

## 回调实参回填

方法调用的实参里如果直接写匿名对象或 lambda，且被调用方法的对应参数是对象类型（回调），实参内的参数也会按回调签名自动回填：

```ooc
Callback #type { apply(x: number) };
Processor #type { run(cb: Callback) };

p: Processor = { run(cb) { cb apply 1 } };
p run { apply(x) { x * 2 } }   // 匿名回调对象：x 自动是 number
p run [x -> x + 1]             // lambda 回调：x 自动是 number
```

- 支持泛型实例化的回调签名（`forEach(cb: T)` 实例化为 `Callback` 时同样回填）
- 回调方法体内参数照常参与类型检查（如 `x = 'str'` 对 `number` 警告）
- 没有回调上下文时（如参数是 `any`），实参内参数保持 `any` 不检查

## 检查对象是否符合类型

```ooc
Animal #type { speak(): string };
animal = { speak() => 'voice' };

dog: Animal = { ...animal, bark() => 'wang' };   // 通过
bad: Animal = { bark() => 'wang' };              // 警告：缺少 speak
```

类型不符时给出 warning 诊断，代码仍可正常运行。
