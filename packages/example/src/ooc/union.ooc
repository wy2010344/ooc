// union.ooc — 字面量类型 + 可区分联合
// #guard 分支链（if/else-if/else）：命中分支的语句段执行完即返回，全不命中走 #else。
// 分支不用花括号，靠分号分段。
Circle #type { kind() : 'circle', radius: number };
Square #type { kind() : 'square', side: number };

area = {
    calc(s: Circle | Square) {
        #guard (s kind) == 'circle';
        (s radius) * (s radius)
        #guard (s kind) == 'square';
        (s side) * (s side)
        #else;
        nil
    }
};

c: Circle = { kind() { 'circle' }, radius() { 3 } };
area calc c;

// 未判别直接访问专属成员会触发 partialUnionMessage warning
// bad = { calc(s: Circle | Square) { s radius } }

// 覆盖检查：只判别部分成员会触发 unionUncovered warning（漏掉成员的判别分支；
// #else 不算判别，类型层仍要求 #guard 分支全量覆盖）
// missing = { calc(s: Circle | Square) {
//     #guard (s kind) == 'circle';
//     s radius
//     #else;
//     nil
// } }

// 分支感知返回：联合实参调用时返回类型按分支聚合（number | string）
areas = {
    desc(s: Circle | Square) {
        #guard (s kind) == 'circle';
        s radius
        #guard (s kind) == 'square';
        'side=' + (s side)
        #else;
        nil
    }
};
shape: Circle | Square = { kind() { 'circle' }, radius() { 3 } };
areas desc shape
