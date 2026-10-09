// Model → TS 模块代码生成。顶层语句按解释器 interpret 语义：
// import 解包赋值给命名作用域、Assignment 绑定、其余表达式求值、最后一条是模块导出值。
// 产物形态：内联运行时辅助 + export function run(globals)，传入宿主 globals。
import type { Model } from 'object-oriented-c-language'
import { OOC_RUNTIME_SNIPPET } from './runtime-template.js'
import { expressionCode, typeCode } from './expr.js'

export function modelToTs(model: Model): string {
  const topLines: string[] = []
  const bound = new Set<string>()
  for (const st of model.expressions) {
    // Langium 子类型推断：带 ImportList（选择性导入）的语句 $type 为 'ImportList'，仍继承 name/path
    const maybeImport = st as any
    if (maybeImport.$type === 'ImportStatement' || maybeImport.$type === 'ImportList') {
      // import 解析异步（宿主 loader 可加载字节码/网络模块），产物 await 后再用
      const kw = bound.has(maybeImport.name) ? '' : 'let '
      bound.add(maybeImport.name)
      topLines.push(`${kw}${maybeImport.name} = await __import(${JSON.stringify(maybeImport.path)});`)
      continue
    }
    switch (st.$type) {
      case 'Assignment': {
        // 同名重复绑定（objects.ooc 里 calc 两次赋值）用重赋，保持 JS let 语义合法
        const kw = bound.has(st.name) ? '' : 'let '
        bound.add(st.name)
        topLines.push(
          `${kw}${st.name}${typeAnnot(st.typeAnnotation)} = ${expressionCode(st.expression)};`,
        )
        break
      }
      case 'TypeDef':
        // 类型定义：纯编译期形状，运行时无副作用；顶层仅保留 type 声明（可导出供 TS 使用）
        topLines.push(typeDefCode(st))
        break
      default:
        topLines.push(`__last = ${expressionCode(st as any)};`)
        break
    }
  }

  // 宿主 globals 引用收集：遍历源码里直接使用的 Ref，未在当前模块绑定、也不是
  // 语言内建（Array 等 globalThis）的名字 → 从 run(globals) 注入（模拟解释器宿主 globals）。
  const hostRefs = collectHostRefs(model, bound)
  const hostDecls = hostRefs
    .map((name) => `  const ${name} = globals[${JSON.stringify(name)}];`)
    .join('\n')

  const body = topLines.join('\n  ')
  return `${OOC_RUNTIME_SNIPPET}
// ---- 编译产物 ----
declare function __import(path: string): any
export async function run(globals: Record<string, any> = {}, onImport?: (path: string) => any): Promise<any> {
  let __last: any = null
  const __import = (path: string) =>
    (globals && typeof globals.__import === 'function')
      ? globals.__import(path)
      : (onImport ?? (() => { throw new Error('OOC import 未解析: ' + path) }))(path)
${hostDecls}
  ${body}
  return __last
}
export default run
export const runtime = { __send, __createObject }
`
}

function typeAnnot(t?: unknown): string {
  if (!t || !(t as any)?.$type) return ''
  return `: ${typeCode(t)}`
}

/** TypeDef → TS type（形态声明，运行时无副作用）。 */
function typeDefCode(td: any): string {
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
      return `  ${mname}${typeArgs ? `<${typeArgs}>` : ''}(${mparams}): ${ret || 'any'}`
    })
    .join(';\n')
  return `export type ${name}${params ? `<${params}>` : ''} = {\n${members}\n};`
}

/** 语言内建 globalThis 名字：编译产物直接引用，不注入 globals */
const BUILTIN_GLOBALS = new Set([
  'Array', 'Object', 'JSON', 'Math', 'console', 'Promise', 'Number', 'String', 'Boolean',
])

/** 遍历 AST 收集所有 Ref 标识符（顶层、对象构造表达式与方法体），返回待注入的宿主 globals 名。 */
function collectHostRefs(model: Model, topBound: Set<string>): string[] {
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