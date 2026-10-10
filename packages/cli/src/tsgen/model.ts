// Model → TS 代码生成：**纯 ES 模块**（唯一形态，`ooc build`/`ooc compile`/vite-plugin-ooc 共用）。
//
// 语义对齐解释器 interpret：OOC 里所有顶层声明都是模块 export，#import 与 TS import
// 完全等价——
//   x = #import 'm'              → import x from '<m>'
//   #import { a as b, c } 'm'    → import { a as b, c } from '<m>'（类型项走 import type）
//   #import 'm' { T as U }       → import type { T as U } from '<m>'
//   #import 'm';                 → import '<m>';（纯副作用导入，模块必执行）
// 模块在 ES 导入时按其依赖顺序自动执行（解释器也是先执行全部 #import 再跑模块体），
// 重复的底层辅助（__send/__createObject）从共享 runtime 外部导入，宿主 globals 同样静态导入。
// 具体发射规则见 esm.ts；这里只做 re-export，保留 modelToTs 这个对外名字。
import type { Model } from 'object-oriented-c-language'
import { emitEsmModule, type EsmContext } from './esm.js'

export type { EsmContext, ModuleDep } from './esm.js'

/** 编译复用上下文：runtime/globals 的 ES import 目标 + 依赖表。 */
export type ReuseContext = EsmContext

export function modelToTs(model: Model, ctx: ReuseContext): string {
  return emitEsmModule(model, ctx)
}
