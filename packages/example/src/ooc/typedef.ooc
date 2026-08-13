// ===== typedef：用类型形状约束对象（方法签名 + 字段） =====
Point #type {
    x: number,
    y: number,
    dist() : number
};

p: Point = {
    x = 3,
    y = 4,
    dist() { (this x) * (this x) + (this y) * (this y) }
};
p dist;

// 形状不符会触发类型不匹配 warning（可在 VSCode 看到波浪线）
// bad: Point = { x = 1, y = 'two' }

// ===== typedef 继承：'...' 让新类型继承父类型形状 =====
Animal #type { speak(): string };
Dog #type { ...Animal, bark(): string };
d: Dog = { speak() { 'wang' }, bark() { 'bow' } };

// 联合父类型：Labeled 变成 (Circle + label) | (Square + label)
Circle #type { kind(): 'circle', radius: number };
Square #type { kind(): 'square', side: number };
Labeled #type { ...Circle | Square, label(): string };

describe = {
    calc(s: Labeled) {
        #guard (s kind) == 'circle';
        (s label) + ':' + (s radius)
    },
    calc(s: Labeled) {
        #guard (s kind) == 'square';
        (s label) + ':' + (s side)
    }
};

c: Labeled = { kind() { 'circle' }, radius() { 3 }, label() { 'round' } };
describe calc c