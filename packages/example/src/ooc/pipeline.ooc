// 管道 /：把结果继续传给下一条消息
'abcdef' slice 1 3 / slice 1 2;

// 管道 |：把左边结果作为右边消息的第一个参数
add = { call(a, b) => a + b };
3 | add call 5;

// 命名管道 | p -> 表达式：左边结果绑定为参数名
'abcdef' slice 1 3 | s -> s + '!';

// 嵌套对象取值
outer = { inner = { value = 42 } };
outer inner / value