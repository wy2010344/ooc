// AST → TS 片段生成的共享 helper：类型注解与 TypeDef 声明。
// 单文件 compile（model.ts）与 ES 模块产物（esm.ts）共用。
import { expressionCode, restTypeAnnot, typeAnnot } from './expr.js'

export { expressionCode, typeAnnot }

/** 定义键 → 文本：StID 带前导 `"`，Str 已去引号，Dollar 是 `$`。 */
function memberName(n: any): string {
  const raw = n?.name
  if (!raw) return ''
  if (raw.$type === 'StID') return raw.value.slice(1)
  if (raw.$type === 'Dollar') return '$'
  return raw.value ?? ''
}

/** 非标识符键要加引号，否则 `foo-bar: number` 不是合法 TS。 */
function tsKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}

/** TypeDef → TS type（形态声明，运行时无副作用）。 */
export function typeDefCode(td: any): string {
  const name = td.name
  const params = (td.typeParams || []).map((p: any) => p.name).join(', ')
  const members = (td.body?.members || [])
    .map((m: any) => {
      const mname = tsKey(memberName(m.name))
      const typeArgs = (m.typeParams || []).map((p: any) => p.name).join(', ')
      const params = [...(m.params || [])]
      // rest 在 AST 里是独立字段，不补进来会把它当普通属性丢掉
      if (m.restParam) params.push(m.restParam)
      const mparams = params
        .map((p: any) =>
          p === m.restParam
            ? `...${p.name}${restTypeAnnot(p.typeAnnotation)}`
            : `${p.name}${typeAnnot(p.typeAnnotation) || ': any'}`,
        )
        .join(', ')
      const ret = typeAnnot(m.typeAnnotation)
      // 零参无泛型无 rest 成员渲染为属性形态（kind: 'circle'）：TS 可区分联合判别/收窄生效；
      // 泛型零参保持方法形态（TS 属性不能泛型）
      const isProp = (m.params || []).length === 0 && !m.restParam && !typeArgs
      return isProp
        ? `  ${mname}${ret || ': any'}`
        : `  ${mname}${typeArgs ? `<${typeArgs}>` : ''}(${mparams})${ret || ': any'}`
    })
    .join(';\n')
  return `export type ${name}${params ? `<${params}>` : ''} = {\n${members}\n};`
}
