// loop.ooc —— 循环工具（OOC 语言实现，无需宿主桥接）
// 使用：#import '@base/loop' 后 `loop apply fn` / `loop repeat n fn`（base 是内置标准库包）。
// OOC 无控制流关键字：apply 靠方法递归 + #guard 分支链（guard 是真值继续递归，
// 假/NIL/0 时 guard 不通过，落到 #else 的 nil 终止）。
// repeat 次数已知，用 JS 生态数据化（n 长度字符串 split 成数组逐索引调用 fn）。

loop = {
    // loop apply fn：至少调用 fn 一次，只要它返回真值就继续
    apply(fn) {
        (#guard fn apply; {
            this apply fn
        })
        (#else {
            nil
        })
    },
    // loop repeat n fn：恰好调用 fn n 次（第 i 次传索引 i，从 0 起）
    repeat(n, fn) {
        (('x' repeat n) split '') forEach [v, i => fn apply i];
        nil
    }
};

loop
