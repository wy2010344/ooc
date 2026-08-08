// 字面量类型 + 可区分联合：#guard 收窄访问成员专属方法
Circle #type { kind() : 'circle', radius: number };
Square #type { kind() : 'square', side: number };

area = {
    calc(s: Circle | Square) {
        #guard (s kind) == 'circle';
        (s radius) * (s radius)
    },
    calc(s: Circle | Square) {
        #guard (s kind) == 'square';
        (s side) * (s side)
    }
};

c: Circle = { kind() { 'circle' }, radius() { 3 } };
area calc c;

// 未判别直接访问专属成员会触发 partialUnionMessage warning
// bad = { calc(s: Circle | Square) { s radius } }
