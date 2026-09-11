// 测试前导（node --test --import 加载，早于任何测试模块）：
// wy-helper 的信号调度在模块加载时按 globalThis.MessageChannel 是否存在
// 决定用 MessageChannel（浏览器）还是 setTimeout（Node）。
// ≤1.1.3 的 MessageChannel 端口被模块级变量常驻持有，Node 下会让进程挂起不退，
// 因此先置空 MessageChannel 兜底；≥1.1.4 支持 setBatchRunner，这里再显式注入
// setTimeout 调度（一次宏任务合并多笔 set，批量语义不变），进程可正常退出。
globalThis.MessageChannel = undefined
const wy = await import('wy-helper')
if (typeof wy.setBatchRunner === 'function') {
  wy.setBatchRunner((flush) => setTimeout(flush))
}