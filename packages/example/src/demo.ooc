// OOC 示例：对象字面量、方法、可区分联合 + guard 收窄、泛型、lambda

Circle #type { kind(): 'circle', radius: number };
Square #type { kind(): 'square', side: number };

// 可区分联合：按 kind 判别收窄
area = {
    calc(s: Circle | Square) {
        #guard (s kind) == 'circle';
        (s radius) * (s radius) * 3.14
    },
    calc(s: Circle | Square) {
        #guard (s kind) == 'square';
        (s side) * (s side)
    }
};

// 泛型 typedef（类型只做静态检查，运行时不关心）
Box #type<T> { get(): T, set(x: T) };
box: Box<number> = { get() { 42 }, set(x) { x } };

// typedef 继承：单继承（Dog 拥有 Animal 的方法）
Animal #type { speak(): string };
Dog #type { ...Animal, bark(): string };

// typedef 继承：联合父类型 → Labeled 变成 (Circle+label) | (Square+label)
Labeled #type { ...Circle | Square, label(): string };
describe = {
    calc(s: Labeled) {
        #guard (s kind) == 'circle';
        'circle ' + (s label) + ' r=' + (s radius)
    },
    calc(s: Labeled) {
        #guard (s kind) == 'square';
        'square ' + (s label) + ' s=' + (s side)
    }
};

// 对象方法
hello = { greet(name) { 'Hello, ' + name + '!' } };
double = { calc(x) { x * 2 } };

// #import 模块（浏览器中从模块 map 加载源码再执行）
math = #import 'math';

// storage 是宿主注入的 JS 全局对象（不是 OOC 模块）
counter = storage ref 0;
counter set 3;
counter set (counter get + 2);

// 返回一个对象作为结果
{
    circle = (area calc { kind() { 'circle' }, radius() { 3 } }),
    square = (area calc { kind() { 'square' }, side() { 4 } }),
    box = (box get),
    greeting = (hello greet 'OOC'),
    doubled = (double calc 21),
    added = (math add 2 3),
    doubledByModule = (math double 21),
    counter = (counter get),
    dog = ({ speak() { 'wang' }, bark() { 'bow' } }),
    labeled = (describe calc { kind() { 'circle' }, radius() { 3 }, label() { 'round' } })
}
