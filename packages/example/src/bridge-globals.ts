// 宿主桥接 globals：默认导出完整集合（storage/js/delegate + 视图组件 + 响应式信号）。
// .ooc 产物通过虚拟模块 virtual:ooc-globals 静态 import 这里的默认导出，
// 因此宿主对象在模块导入时即可用（不再需要在入口逐个 run(globals) 传递）。
import { createBridgeGlobals } from 'ooc-mve-bridge'

export default createBridgeGlobals()
