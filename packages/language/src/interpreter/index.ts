// 解释器公共 API（原 interpreter.ts 拆分后对外导出的类型与函数保持不变）
export { type Value, sendMessage, respondsTo } from './runtime.js'
export { createInterpretAction, createTypeCheckAction } from './host.js'
export type { Globals } from './scope.js'
export { merge, js, storage, UNHANDLED } from './bridges.js'
export { proxyCatchAll } from './proxy.js'
export { OocCircularImportError, OocMethodNotFoundError } from './errors.js'
