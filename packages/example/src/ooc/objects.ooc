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
dog = { ...animal, bark() => 'wang' };
dog speak;
dog bark
