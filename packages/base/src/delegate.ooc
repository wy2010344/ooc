// delegate.ooc —— 委托组合工具（OOC 语言实现，无需宿主桥接）
// 使用：w = delegate withDefault spec defaults...;
// → 返回包装对象；spec 自有消息优先，未知消息按 defaults 顺序查找。
// 语义：withDefault(x, y) = { ...x, methodNotFound → y }
//       withDefault(x, y, z) = { ...x, methodNotFound → withDefault(y, z) }
//       从左向右递归构建转发链。
delegate = {
    // 基础情况：恰好 2 个参数
    withDefault(x, y) {
        {
            ...x,
            methodNotFound(name, ...args) {
                js send y name args
            }
        }
    },
    // 递归情况：3 个及以上参数
    // 通过 responser 访问 delegate，js send 展开 rest 数组转发
    withDefault(x, ...rest) {
        fallback = js send responser 'withDefault' rest;
        {
            ...x,
            methodNotFound(name, ...args) {
                js send fallback name args
            }
        }
    }
};
delegate
