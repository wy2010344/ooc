// js 桥接：new 是 JS 运算符，消息传递表达不了，走 js new。
// 这里实例化 Date，再发消息调它的方法（发消息访问 JS 对象方法本身是支持的）。
d = js new Date 2026 0 1;
year = d getFullYear;
month = d getMonth;

// lambda 本就是原生 JS 函数，可直接传给定时器/事件监听等宿主 API
cb = [42];
called = (cb) apply;

{
    year = year,
    month = month,
    called = called
}
