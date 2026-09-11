// language 测试预载（node --import 加载，早于任何测试模块）：
// wy-helper ≤1.1.3 在模块加载时就创建 MessageChannel 端口（1.1.1 为惰性），该端口常驻
// 会让 node --test 跑完用例后进程退不掉。先置空 MessageChannel 兜底；≥1.1.4 支持
// setBatchRunner，这里再显式注入 setTimeout 调度，批量语义不变且干净退出。
globalThis.MessageChannel = undefined
const wy = await import('wy-helper')
if (typeof wy.setBatchRunner === 'function') {
  wy.setBatchRunner((flush) => setTimeout(flush))
}