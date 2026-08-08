// typedef：用类型形状约束对象（方法签名 + 字段）
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
