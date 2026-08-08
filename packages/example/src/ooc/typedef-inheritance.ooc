// typedef 继承：'...' 让新类型继承父类型形状（单继承，自有方法覆盖同名）
Animal #type { speak(): string };
Dog #type { ...Animal, bark(): string };
d: Dog = { speak() { 'wang' }, bark() { 'bow' } };

// 联合父类型：Labeled 变成 (Circle + label) | (Square + label)。
// 只在部分分支上的方法需 #guard 判别后再访问。
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
