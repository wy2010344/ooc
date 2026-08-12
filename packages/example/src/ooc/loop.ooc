// loop apply：while 循环，lambda 返回真值就继续，返回假值（nil/false/0）就停。
// 注意：没有控制流关键字，可变计数靠 storage 桥接的 cell。
n = storage ref 0;
step = [n set ((n get) + 1); (n get) < 5];
loop apply step;

// 结果对象（模块最后一条表达式是导出值）
{ iterations = (n get) }
