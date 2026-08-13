// 诊断错误示例：这些行会触发 IDE 波浪线
// 配置由 config.ooc / ooc.json 决定显示级别（off / warning / error）

// === 类型检查类 ===

// 1. unknownType：未知类型名
// x: Foo = 33;

// 2. typeMismatch：类型不匹配
// x: number = 'hello';

// 3. typeNotFound：类型未找到
// x: MissingType = 1;

// 4. noImplicitAny：隐式 any（默认 off，需显式开启）
// calc = { add(n) { n + 1 } };

// 5. notGeneric：非泛型类型上使用了类型参数
// Point<number> = { x = 1, y = 2 };

// 6. typeArgCount：类型参数数量不匹配
// Box #type<T> { get(): T };
// bad: Box<number, string> = { get() { 1 } };

// 7. missingTypeArg：缺少类型参数
// bad: Box = { get() { 1 } };

// === 调用与重载类 ===

// 8. callArgsMismatch：调用参数数量不匹配
// calc = { add(a: number, b: number) { a + b } };
// calc add 1 'x';

// 9. overloadReturnMismatch：重载方法返回类型不匹配
// obj = { fun(): number { 'str' }, fun(): string { 'ok' } };

// 10. guardNotBoolean：#guard 条件不是布尔
// obj = { fun(a: number) { #guard a; a } };

// 11. partialUnionMessage：联合类型成员专属方法未判别
// c: Circle | Square = { kind() { 'circle' }, radius() { 3 } };
// bad = { calc(s: Circle | Square) { s radius } };

// === 重复定义类 ===

// 12. duplicateType：重复的 typedef
// Point #type { x: number };
// Point #type { y: number };

// 13. duplicateMethod / duplicateParam：重复定义
// obj = { fun() { 1 }, fun() { 2 } };
// bad = [a, a -> a];

// === 变量与赋值类 ===

// 14. reassignmentMismatch：重新赋值类型不匹配
// x: number = 42;
// x = 'string';