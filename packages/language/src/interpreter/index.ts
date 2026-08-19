// 解释器公共 API（原 interpreter.ts 拆分后对外导出的类型与函数保持不变）
export { type ObjectValue, type Value, invoke, sendMessage } from './runtime.js'
export { createInterpretAction, createTypeCheckAction } from './host.js'
export type { Globals } from './scope.js'
export { js, loop, storage } from './bridges.js'
export { OocCircularImportError, OocMethodNotFoundError } from './errors.js'
