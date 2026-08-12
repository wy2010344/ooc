// loop 的边界：while 语义「至少调用一次」——lambda 立即返回假值也会先跑一次
called = storage ref 0;
loop apply [called set 1; nil];
first = (called get);

// 返回 0（假值）立即停，但已经执行了一次
called0 = storage ref 0;
loop apply [called0 set 1; 0];
zeroStops = (called0 get);

// 递减计数到 0 停止：3 次调用
count = storage ref 3;
runs = storage ref 0;
step = [runs set ((runs get) + 1); count set ((count get) - 1); (count get) > 0];
loop apply step;

{
    first = first,
    zeroStops = zeroStops,
    runs = (runs get),
    count = (count get)
}
