// loop repeat：恰好执行 n 次的有限循环，与 loop apply 互补
sum = storage ref 0;
loop repeat 5 [sum set ((sum get) + 2)];

// 0 次：lambda 一次都不执行
touched = storage ref 0;
loop repeat 0 [touched set 1];

{ sum = (sum get), touched = (touched get) }
