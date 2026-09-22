// delegate.ooc —— 委托组合工具（OOC 语言实现，无需宿主桥接）
// 使用：w = delegate withDefault spec defaults...;
// → 返回包装对象：spec 的方法扁平拷贝到包装（自有消息优先），
//   未知消息按 defaults 顺序转发（methodNotFound 兜底）。
// 语义：withDefault(x, y) = { 拷贝 x 的方法, methodNotFound → y }
//       withDefault(x, y, z) = { 拷贝 x 的方法, methodNotFound → withDefault(y, z) }
//       从左向右递归构建转发链。
// 无继承：靠 js new Object + Object.assign 把 spec 的方法拷贝进包装对象；
// 拷贝出的函数仍是原闭包，调用时 this 是包装对象（等同于原型链效果）。
delegate = {
    // 基础情况：恰好 2 个参数
    withDefault(x, y) {
        wrapper = js new Object;
        js send Object 'assign' wrapper x;
        js send Object 'assign' wrapper { methodNotFound(name, ...args) { js send y name args } };
        wrapper
    },
    // 递归情况：3 个及以上参数
    // 通过 this 访问 delegate，js send 展开 rest 数组转发
    withDefault(x, ...rest) {
        fallback = js send this 'withDefault' rest;
        wrapper = js new Object;
        js send Object 'assign' wrapper x;
        js send Object 'assign' wrapper { methodNotFound(name, ...args) { js send fallback name args } };
        wrapper
    }
};
delegate