// 对象与方法
calc = {
    add(a, b) => a + b,
    sub(a, b) { a - b },
    cached = 1 + 2,
    inc(n) { this cached + n }
};
calc add 3 4;
calc cached;
calc inc 3;

// 守卫与重载：guard 不满足时找下一个同名方法
size = {
    check(n):string { #guard n > 100; 'big' },
    check(n):string { 'small' }
};
size check 200;
size check 5;
animal = { speak() => 'voice' };
// 无继承：对象直接携带全部方法（复用与兜底交给 withDefault 委托）
dog = { speak() => 'voice', bark() => 'wang' };
dog speak;
dog bark;

// 签名方法：无函数体的声明只写返回类型，是纯类型层承诺（检查器用）
// 运行时分发交给有实现的同名方法
calc = {
    area(radius: number): number,
    area(radius: string): string,
    area(r) { r }
};
calc area 3;
calc area 'x';

// 可调用对象：apply 就是普通方法，和其它方法一起挂载
math = { apply(x) => x * 3, square(x) => x * x };
math apply 2;
math square 4;

// 转发属性 <=：本 key 的一切消息原样转发给委托对象的 apply 执行
// （消息名不传给 apply，只传实参）。委托 apply 用 rest 参数兼容任意参数数量，
// 无参消息 `box value` 同样转发（→ double apply()，空数组）。
double = { apply(...args) { args } };
box = { value <= double };
box value 21;
box value   // 无参消息同样转发（→ double apply()，返回 []）
