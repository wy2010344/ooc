// 泛型 typedef：类型参数 + 实例化
Box #type<T> {
    get() : T,
    set(x: T)
};

intBox: Box<number> = {
    get() { 42 },
    set(x) { x }
};
intBox get;

strBox: Box<string> = {
    get() { 'ooc' },
    set(x) { x }
};
strBox get;

// 实例化类型不符会告警（取消注释看波浪线）
// bad: Box<number> = { get() { 'not a number' } }
