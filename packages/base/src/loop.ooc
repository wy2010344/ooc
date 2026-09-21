// loop.ooc —— 循环工具（OOC 语言实现，无需宿主桥接）
// 使用：#import 'loop' 后 `loop apply fn` / `loop repeat n fn`。
// OOC 无控制流关键字：apply 靠方法递归 + #guard 短路（fn 返回真继续，
// 假/NIL/0 时 guard 不通过、沿原型链落到 stop.apply 返回 nil 终止）；
// repeat 次数已知，用 JS 生态数据化（n 长度字符串 split 成数组逐索引调用 fn）。
// 注意：repeat 借 'x' repeat n（JS String#repeat）——n 非法时异常由 JS 抛
// （负数 RangeError、小数自动截断），不再像宿主版严格校验非负整数。

// apply 的终止兜底：guard 不通过时沿原型链找到这里，返回 nil 静默结束
stop = {
    apply(fn) => nil
};

loop = {
    // loop apply fn：至少调用 fn 一次，只要它返回真值就继续
    ...stop,
    apply(fn) {
        #guard fn apply;
        currentObject apply fn
    },
    // loop repeat n fn：恰好调用 fn n 次（第 i 次传索引 i，从 0 起）
    repeat(n, fn) {
        (('x' repeat n) split '') forEach [v, i => fn apply i];
        nil
    }
};

loop