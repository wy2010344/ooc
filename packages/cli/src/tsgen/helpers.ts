// AST → TS 片段生成的共享 helper：类型注解、TypeDef 声明、宿主 globals 引用收集。
// 单文件 compile（model.ts）与 ES 模块产物（esm.ts）共用。
import type { Model } from 'object-oriented-c-language'
import { expressionCode, typeCode } from './expr.js'

export function typeAnnot(t?: unknown): string {
  if (!t || !(t as any)?.$type) return ''
  return `: ${typeCode(t)}`
}

/** TypeDef → TS type（形态声明，运行时无副作用）。 */
export function typeDefCode(td: any): string {
  const name = td.name
  const params = (td.typeParams || []).map((p: any) => p.name).join(', ')
  const members = (td.body?.members || [])
    .map((m: any) => {
      const mname = m.name?.name?.value ?? ''
      const typeArgs = (m.typeParams || []).map((p: any) => p.name).join(', ')
      const mparams = (m.params || [])
        .map((p: any) => `${p.name}${typeAnnot(p.typeAnnotation)}`)
        .join(', ')
      const ret = typeAnnot(m.typeAnnotation)
      return `  ${mname}${typeArgs ? `<${typeArgs}>` : ''}(${mparams})${ret || ': any'}`
    })
    .join(';\n')
  return `export type ${name}${params ? `<${params}>` : ''} = {\n${members}\n};`
}

/** 语言内建 globalThis 名字：编译产物直接引用，不注入 globals */
const BUILTIN_GLOBALS = new Set([
  'Array', 'Object', 'JSON', 'Math', 'console', 'Promise', 'Number', 'String', 'Boolean',
])

/** 遍历 AST 收集所有 Ref 标识符（顶层、对象构造表达式与方法体），返回待注入的宿主 globals 名。 */
export function collectHostRefs(model: Model, topBound: Set<string>): string[] {
  const refs = new Set<string>()
  const bounds = new Set<string>(topBound)
  // 先扫全树收集绑定名（参数、lambda 参数、嵌套赋值、简单属性读取等），再收集 Ref
  const walkRefs = (node: any, out: Set<string>): void => {
    if (!node || typeof node !== 'object') return
    if (node.$type === 'Ref') {
      if (typeof node.value === 'string') out.add(node.value)
      return
    }
    if (node.$type === 'MethodCallName' || node.$type === 'MethodDefName') {
      return // 消息名/方法名不是变量引用
    }
    if (typeof node.$type === 'string') {
      for (const key of Object.keys(node)) {
        if (key.startsWith('$')) continue // 跳过 Langium 元字段，防环
        const v = (node as any)[key]
        if (Array.isArray(v)) for (const item of v) walkRefs(item, out)
        else if (v && typeof v === 'object') walkRefs(v, out)
      }
    }
  }
  const collectBindings = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (node.$type === 'Param') {
      if (node.name) bounds.add(node.name)
    } else if (node.$type === 'Assignment') {
      if (node.name) bounds.add(node.name)
    }
    // 方法名不绑进变量作用域（OOC 需 this.xxx 取成员），不加入 bounds
    if (typeof node.$type === 'string') {
      for (const key of Object.keys(node)) {
        if (key.startsWith('$')) continue // 跳过 $type/$container 等 Langium 元字段，防环
        const v = (node as any)[key]
        if (Array.isArray(v)) for (const item of v) collectBindings(item)
        else if (v && typeof v === 'object') collectBindings(v)
      }
    }
  }
  for (const st of model.expressions) {
    collectBindings(st)
    walkRefs(st, refs)
  }
  refs.delete('this')
  return Array.from(refs).filter(
    (name) =>
      !bounds.has(name) &&
      !BUILTIN_GLOBALS.has(name) &&
      !['globalThis', 'undefined', 'NaN', 'Infinity'].includes(name),
  )
}

export { expressionCode }
