// ===== loop apply：while 循环，lambda 返回真值继续，假值（nil/false/0）停止 =====
// 注意：没有控制流关键字，可变计数靠 storage 桥接的 cell。

// 基本循环：计数到 5
n = storage ref 0;
step = [n set ((n get) + 1); (n get) < 5];
loop apply step;
iterationsResult = { iterations = (n get) };

// loop apply 边界：至少执行一次（即使 lambda 立即返回假值）
called = storage ref 0;
loop apply [called set 1; nil];
first = (called get);

// 0 也是假值，立即停但已跑一次
called0 = storage ref 0;
loop apply [called0 set 1; 0];
zeroStops = (called0 get);

// 递减计数到 0
count = storage ref 3;
runs = storage ref 0;
decStep = [runs set ((runs get) + 1); count set ((count get) - 1); (count get) > 0];
loop apply decStep;

// ===== loop repeat：恰好执行 n 次的有限循环 =====
sum = storage ref 0;
loop repeat 5 [sum set ((sum get) + 2)];

// 0 次：lambda 一次都不执行
touched = storage ref 0;
loop repeat 0 [touched set 1];

// ===== storage + loop 组合：1..10 求和 =====
total = storage ref 0;
i = storage ref 10;
sumStep = [total set ((total get) + (i get)); i set ((i get) - 1); (i get) > 0];
loop apply sumStep;

{
    loopIterations = (n get),
    loopRuns = (runs get),
    repeatSum = (sum get),
    repeatTouched = (touched get),
    sum_1_to_10 = (total get)
}