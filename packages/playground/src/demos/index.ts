import type { DemoEntry } from './types.js'
import { hello } from './hello.js'
import { arithmetic } from './arithmetic.js'
import { host } from './host.js'
import { preview } from './preview.js'
import { todo } from './todo.js'
import { utilLib } from './util-lib.js'
import { crossImport } from './cross-import.js'
import { loopLib } from './loop-lib.js'

export type { DemoEntry } from './types.js'

// 预览/待办源码在测试里复用到，单独导出常量。
// 其余 demo 只作播种/展示，不必导出源码常量。
export { TODO_DEMO } from './todo.js'
export { PREVIEW_DEMO } from './preview.js'
export { LOOP_LIB_SOURCE, loopLib } from './loop-lib.js'

/**
 * 首次打开时的演示笔记（播种）。新增 demo：在 src/demos/ 建模块，导出 DemoEntry，
 * 然后在这里登记一条即可——播种/开发面板/测试都从本数组取，单一来源不漂移。
 */
export const DEMO_NOTES: Array<DemoEntry> = [
  hello,
  arithmetic,
  utilLib,
  crossImport,
  host,
  loopLib,
  preview,
  todo,
]