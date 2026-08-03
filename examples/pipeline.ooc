// 管道 /：把结果继续传给下一条消息
'abcdef' slice 1 3 / slice 1 2;

// 管道 |：把左边结果作为右边消息的第一个参数
add = { call(a, b) => a + b };
3 | add call 5;

// 管道 | 命名占位：左边值绑定为名字
'abcdef' slice 1 3 | s => s + '!';

// 嵌套对象取值
outer = { inner = { value = 42 } };
outer inner / value
