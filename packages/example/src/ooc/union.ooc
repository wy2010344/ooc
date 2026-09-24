// 字面量类型 + 可区分联合：#guard 收窄访问成员专属方法
Circle #type { kind() : 'circle', radius: number };
Square #type { kind() : 'square', side: number };

// guard 只在多分支重载组里起作用：末尾分支是无条件兜底（else）
area = {
    calc(s: Circle | Square) {
        #guard (s kind) == 'circle';
        (s radius) * (s radius)
    },
    calc(s: Circle | Square) {
        #guard (s kind) == 'square';
        (s side) * (s side)
    },
    calc(s: Circle | Square) {
        nil
    }
};

c: Circle = { kind() { 'circle' }, radius() { 3 } };
area calc c;

// 未判别直接访问专属成员会触发 partialUnionMessage warning
// bad = { calc(s: Circle | Square) { s radius } }

// 覆盖检查：只判别部分成员会触发 unionUncovered warning（漏掉 Square 的判别分支，
// 末尾兜底不算判别，类型层仍要求 guard 分支全量覆盖）
// missing = { calc(s: Circle | Square) { #guard (s kind) == 'circle'; s radius }, calc(s: Circle | Square) { nil } }

// 分支感知返回：联合实参调用时返回类型按分支聚合（number | string）
areas = {
    desc(s: Circle | Square): number {
        #guard (s kind) == 'circle';
        s radius
    },
    desc(s: Circle | Square): string {
        #guard (s kind) == 'square';
        'side=' + (s side)
    },
    desc(s: Circle | Square): nil {
        nil
    }
};
shape: Circle | Square = { kind() { 'circle' }, radius() { 3 } };
areas desc shape
