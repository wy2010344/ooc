// 类型注解：只做提示，不影响运行
x: Number = 42;
greet: string = 'hi';

// typedef 定义类型形状（方法签名）
Animal #type { speak(): string };
animal = { speak() => 'voice' };

// 对象赋值到带类型注解的变量，检查方法签名是否吻合
dog: Animal = { ...animal, bark() => 'wang' };

// 联合类型
result: Number | string = 1;
result
