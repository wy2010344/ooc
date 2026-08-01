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

## 检查对象是否符合类型

```ooc
Animal #type { speak(): string };
animal = { speak() => 'voice' };

dog: Animal = { ...animal, bark() => 'wang' };   // 通过
bad: Animal = { bark() => 'wang' };              // 警告：缺少 speak
```

类型不符时给出 warning 诊断，代码仍可正常运行。
