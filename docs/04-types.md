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

## 检查对象是否符合类型

```ooc
Animal #type { speak(): string };
animal = { speak() => 'voice' };

dog: Animal = { ...animal, bark() => 'wang' };   // 通过
bad: Animal = { bark() => 'wang' };              // 警告：缺少 speak
```

类型不符时给出 warning 诊断，代码仍可正常运行。
