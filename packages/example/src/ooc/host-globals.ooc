// console、Math 都是 JS 全局，解释器回退到 globalThis 就能找到，无需宿主注入。
// 这里顺带验证 storage + loop 的组合：1..10 求和
console log '来自 OOC 的日志（console 走 globalThis）';

total = storage ref 0;
n = storage ref 10;
step = [total set ((total get) + (n get)); n set ((n get) - 1); (n get) > 0];
loop apply step;

{
    sum_1_to_10 = (total get),
    sqrt_16 = (Math sqrt 16),
    max_3_7 = (Math max 3 7),
    pi = (Math PI)
}
