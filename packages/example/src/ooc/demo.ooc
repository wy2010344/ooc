// OOC 综合示例：覆盖所有语言特性
// 类型、对象、泛型、lambda、guard、继承、导入、JS 桥接等

// ===== 1. 可区分联合 + guard 收窄 =====
Circle #type { kind(): 'circle', radius: number };
Square #type { kind(): 'square', side: number };

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

// ===== 2. 泛型 typedef =====
Box #type<T> { get(): T, set(x: T) };
intBox: Box<number> = { get() { 42 }, set(x) { x } };

// 实例化类型不符会告警（取消注释看波浪线）
// bad: Box<number> = { get() { 'not a number' } }

// ===== 3. typedef 继承 =====
Animal #type { speak(): string };
Dog #type { ...Animal, bark(): string };

// 联合父类型继承
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

// ===== 4. 对象方法与 lambda =====
hello = { greet(name) { 'Hello, ' + name + '!' } };
double = { calc(x) { x * 2 } };

// ===== 5. #import 模块 =====
math = #import 'math';

// ===== 6. storage（宿主注入的 JS 全局对象） =====
counter = storage ref 0;
counter set 3;
counter set (counter get + 2);

// ===== 7. JS 桥接 =====
d = js new Date 2026 0 1;
year = d getFullYear;

// ===== 8. 管道操作 =====
result = 'hello' slice 0 4 | s => s + ' world';

// ===== 返回汇总对象 =====
{
    circle = (area calc { kind() { 'circle' }, radius() { 3 } }),
    square = (area calc { kind() { 'square' }, side() { 4 } }),
    box = (intBox get),
    greeting = (hello greet 'OOC'),
    doubled = (double calc 21),
    added = (math add 2 3),
    doubledByModule = (math double 21),
    counter = (counter get),
    dog = ({ speak() { 'wang' }, bark() { 'bow' } }),
    labeledCircle = (describe calc { kind() { 'circle' }, radius() { 3 }, label() { 'round' } }),
    year = year,
    piped = result
}