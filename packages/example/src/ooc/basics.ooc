// ===== 变量与基本类型 =====
x = 42;
name = 'ooc';
flag = true;
empty = nil;

// ===== 运算符（无优先级，左结合） =====
1 + 2;
7 - 3;
6 * 4;
7 % 3;
10 > 5;
10 >= 5;
10 == 10;
1 && 0;

// ===== 字符串（空格调用方法） =====
'abcdef' slice 1 3;
'abc' + 'def';
'abcdef' length;

// ===== JS 全局（解释器回退 globalThis） =====
Math PI;
console log 'hello from ooc';

// ===== 消息调用 =====
hello = { greet(name) => 'hello, ' + name };
hello greet 'ooc'

// ===== 注释：// 单行、/* 多行 */