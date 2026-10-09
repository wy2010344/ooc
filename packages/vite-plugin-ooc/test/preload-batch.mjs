// vite-plugin-ooc 测试预载（node --import 加载，早于任何测试模块）：
// wy-helper ≤1.1.3 在模块加载时就创建 MessageChannel 端口，会让 node --test
// 跑完用例后进程挂起。先置空 globalThis.MessageChannel 兜底，再调
// wy.setBatchRunner 显式注入测试调度（≥1.1.4 支持），干净退出。
globalThis.MessageChannel = undefined
const wy = await import('wy-helper')
if (typeof wy.setBatchRunner === 'function') {
  wy.setBatchRunner((flush) => setTimeout(flush))
}