// 错误示范：这些行会触发诊断（取消注释即可在 VSCode 看到波浪线）
// 由 ooc.json 决定显示级别（off / warning / error）

// 1. unknownType：未知类型名（本示例在 ooc.json 里配成了 off，默认不显示）
// x: Foo = 33;

// 2. typeMismatch：类型不匹配（warning）
// x: number = 'hello';

// 3. callArgsMismatch：调用参数不匹配（warning）
// calc = { add(a: number, b: number) { a + b } };
// calc add 1 'x';

// 4. duplicateMethod / duplicateParam：重复定义（error，无法配置降级）
// obj = { fun() { 1 }, fun() { 2 } };
// bad = [a, a -> a];

// 5. guardNotBoolean：#guard 条件不是布尔（warning）
// obj = { fun(a: number) { #guard a; a } };
