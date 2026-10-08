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

// ===== typedef 组合（无继承：交集 & 合并形状） =====
Animal #type { speak(): string };
Dog #type { speak(): string, bark(): string };
d: Dog = { speak() { 'wang' }, bark() { 'bow' } };

// 类型交集：同一值同时满足两个形状（替代继承的「形状合并」，无隐式链）
Named #type { label(): string };
tagged: Animal & Named = { speak() { 'wang' }, label() { 'round' } };

(d speak) + ' ' + (tagged label)