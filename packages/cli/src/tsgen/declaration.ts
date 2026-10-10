// 为编译产物生成同名 `.d.ts`：让 TS 侧 import 编译后的 .ooc 模块时拿到真实类型，
// 而不是退回 any。内容分两部分——
//   - `#type` → `export type X = { ... }`（与 .ts 产物里的形状一致，直接复用 typeDefCode）
//   - 顶层声明（值）→ `export declare const name: T`，类型来自 type-checker 的
//     inferModuleResult（与 LSP/type-check 同一套推断），默认导出同理。
// 未导入解析器：#import 的类型成员在本文件里拿不到，按 any 处理（与 LSP 文档未加载时一致）。
import type { Model } from 'object-oriented-c-language'
import {
  ObjectOrientedCTypeChecker,
  type MethodSig,
  type TypeInfo,
} from 'object-oriented-c-language'
import { typeDefCode } from './helpers.js'

/** TypeInfo → TS 类型串：渲染不出来的一律退 any，保证 d.ts 永远合法。
 *  widen=true 时把字面量放宽成基础类型（用于顶层声明：`scale: 2` 会让使用者没法再赋值），
 *  方法签名里的字面量保持精确（区分联合/guard 要用）。 */
function tsTypeOf(t: TypeInfo | undefined, widen = false): string {
  if (!t) return 'any'
  switch (t.kind) {
    case 'any':
    case 'function':
      return 'any'
    case 'name':
      return t.name
    case 'literal':
      if (!widen) {
        return typeof t.value === 'string' ? `'${t.value}'` : String(t.value)
      }
      return typeof t.value === 'string' ? 'string' : typeof t.value === 'number' ? 'number' : 'boolean'
    case 'union':
      return t.types.map((x) => tsTypeOf(x, widen)).join(' | ')
    case 'intersection':
      return t.types.map((x) => tsTypeOf(x, widen)).join(' & ')
    case 'object': {
      // 命名类型直接用名字（typedef 已由 d.ts 声明），匿名对象渲染方法形状
      if (t.name) return t.name
      const members = [...t.methods].map(([name, sigs]) => sigSignature(name, sigs))
      return `{ ${members.join('; ')} }`
    }
  }
}

function sigSignature(name: string, sigs: MethodSig[]): string {
  const first = sigs[0]
  if (!first) return `${name}(...args: any[]): any`
  const params = first.params.map((p, i) => `p${i}: ${tsTypeOf(p)}`)
  if (first.rest) params.push(`...rest: ${tsTypeOf(first.rest)}[]`)
  return `${name}(${params.join(', ')}): ${tsTypeOf(first.returns)}`
}

/** Model → 同名 .d.ts 的内容。 */
export function modelToDeclaration(model: Model): string {
  const checker = new ObjectOrientedCTypeChecker()
  const info = checker.inferModuleResult(model)
  const lines: string[] = ['// Generated from ooc (ooc → d.ts)']
  // typedef：与 .ts 产物同形（typeDefCode 产出 export type ...）
  for (const st of model.expressions) {
    if (st.$type === 'TypeDef') {
      lines.push(typeDefCode(st))
    }
  }
  // 值导出：顶层赋值 / 导入绑定（顶层位置放宽字面量）
  for (const [name, exp] of info.namedExports) {
    if (exp.kind === 'type') continue
    lines.push(`export declare const ${name}: ${tsTypeOf(exp.type, true)};`)
  }
  // 默认导出：模块最后一条表达式的结果
  lines.push(`export default ${tsTypeOf(info.result, true)};`)
  return lines.join('\n') + '\n'
}
