// 解释器公共 API（原 interpreter.ts 拆分后对外导出的类型与函数保持不变）
export { type OocObject, type Value, sendMessage } from './runtime.js'
export { createInterpretAction, createTypeCheckAction } from './host.js'
export type { Globals } from './scope.js'
export { delegate, js, storage } from './bridges.js'
export { OOC_METHOD } from '../member-kind.js'
export { proxyCatchAll } from './proxy.js'
export { OocCircularImportError, OocMethodNotFoundError } from './errors.js'
