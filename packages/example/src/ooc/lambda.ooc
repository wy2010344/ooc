// lambda：闭包、多参数、函数体多语句、作为消息参数
addOne = [x -> x + 1];
addOne apply 41;

addTwo = [a, b -> a + b];
addTwo apply 20 22;

closure = [x -> y = x + 1; y * 2];
closure apply 20;

// 闭包捕获外层变量
base = 100;
offset = [x -> x + base];
offset apply 41;

// lambda 作为参数传给对象方法
caller = { call(f) => f apply 42 };
caller call [x -> x * 2];
