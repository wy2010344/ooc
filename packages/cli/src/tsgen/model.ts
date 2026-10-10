// Model → TS 模块代码生成。顶层语句按解释器 interpret 语义：
// 默认导入 name=#import '..' 绑定模块默认导出（最后一条表达式结果）、
// 命名导入 #import {a as b} '..' 绑定模块顶层声明（path 之前）、
// 类型导入 #import '..' { T as U } 只走编译期（path 之后）；三者可共存。
// Assignment 绑定、其余表达式求值、最后一条是默认导出（__last 返回）。
// 模块所有顶层声明通过 __oocNamed 包再导出。两种产物形态：
//  - 单文件 compile（默认）：内联运行时辅助 + export function run(globals)，import 走 __import loader。
//  - 项目 build（ctx 提供 runtimeImport/deps）：共享 _ooc_runtime.ts + 依赖模块 ES import。
import type { Model } from 'object-oriented-c-language'
import { OOC_RUNTIME_SNIPPET } from './runtime-template.js'
import { expressionCode, typeCode } from './expr.js'

/** 项目 build 的依赖：path 是 AST 里的 #import 原值，specifier 是 ES import 目标（相对本产物）。 */
export type ModuleDep = {
  path: string
  specifier: string
  /** 依赖模块的类型导出（typedef/#type 名）：命名导入用它区分「类型」与「值」 */
  typeNames?: string[]
  /** 依赖源是否为 .ooc 模块：.ooc 顶层声明经 __oocNamed 包导出；.ts 依赖用原生 ES 导出 */
  ooc: boolean
}

export type ReuseContext = {
  runtimeImport: string
  deps: ModuleDep[]
}

export function modelToTs(model: Model, ctx?: ReuseContext): string {
  const topLines: string[] = []
  const typeLines: string[] = []
  const typeImportLines: string[] = []
  const bagImports: string[] = []
  const esmNamedImports: string[] = []
  const bound = new Set<string>()
  const declNames: string[] = []
  const declSeen = new Set<string>()
  // 已发射的 ES 导入（防重复声明）
  const emittedImports = new Set<string>()
  // 依赖 import 绑定名：_m0/_m1... 在文件顶部由 ES import 声明
  const depIndex = new Map<string, number>()
  // 已为该依赖发射 run 调用的变量名（每个依赖只跑一次，填 __oocNamed 包/取默认导出）
  const depRunVar = new Map<number, string>()
  if (ctx) {
    ctx.deps.forEach((d, i) => depIndex.set(d.path, i))
  }

  const pushDecl = (name: string) => {
    if (!declSeen.has(name)) {
      declSeen.add(name)
      declNames.push(name)
    }
  }

  // 发射 import type 行（去重）：类型导入走编译期，不加载/不执行目标模块
  const emitTypeImport = (original: string, alias: string, spec: string) => {
    const as = alias === original ? '' : ` as ${alias}`
    const line = `import type { ${original}${as} } from '${spec}';`
    if (!emittedImports.has(line)) {
      emittedImports.add(line)
      typeImportLines.push(line)
    }
  }
  const emitRun = (depI: number) => {
    if (!depRunVar.has(depI)) {
      depRunVar.set(depI, `_m${depI}v`)
      topLines.push(`const _m${depI}v = await _m${depI}(globals);`)
    }
    return depRunVar.get(depI)!
  }

  for (const st of model.expressions) {
    const maybeImport = st as any
    if (maybeImport.$type === 'ImportStatement') {
      const depI =
        ctx && depIndex.has(maybeImport.path)
          ? depIndex.get(maybeImport.path)!
          : undefined
      const spec = depI != null ? ctx!.deps[depI].specifier : undefined
      const isOocDep = spec != null && ctx != null && ctx.deps[depI as number].ooc

      // 默认导入（name = #import 'p'）：绑定模块默认导出（最后一条表达式结果）
      // 三种成分（name / named / types）可共存，依次处理、不提前 continue
      if (maybeImport.name) {
        const kw = bound.has(maybeImport.name) ? '' : 'let '
        bound.add(maybeImport.name)
        pushDecl(maybeImport.name)
        if (ctx && depI != null) {
          topLines.push(`${kw}${maybeImport.name} = ${emitRun(depI)};`)
        } else {
          topLines.push(
            `${kw}${maybeImport.name} = (await __import(${JSON.stringify(maybeImport.path)})).last;`,
          )
        }
      }

      // 命名导入（path 之前）：#import { a as b, c } 'path'
      if (maybeImport.named) {
        for (const item of maybeImport.named.items) {
          const original = item.name
          const alias = item.alias ?? original
          const isType =
            spec != null && (ctx!.deps[depI as number].typeNames ?? []).includes(original)
          if (isType) {
            // 类型导出：import type 即可，不加载/不执行依赖模块
            if (spec != null) {
              emitTypeImport(original, alias, spec)
            }
            continue
          }
          const kw = bound.has(alias) ? '' : 'let '
          bound.add(alias)
          pushDecl(alias)
          if (ctx && depI != null && isOocDep) {
            // .ooc 命名值导出：先 await run 填充 __oocNamed 包，再从包取值
            emitRun(depI)
            const bagLine = `import { __oocNamed as _m${depI}n } from '${spec}';`
            if (!emittedImports.has(bagLine)) {
              emittedImports.add(bagLine)
              bagImports.push(bagLine)
            }
            topLines.push(`${kw}${alias} = _m${depI}n[${JSON.stringify(original)}];`)
          } else if (ctx && depI != null) {
            // .ts 依赖命名值导出：原生 ES import
            const line = `import { ${original}${item.alias ? ` as ${alias}` : ''} } from '${spec}';`
            if (!emittedImports.has(line)) {
              emittedImports.add(line)
              esmNamedImports.push(line)
            }
            topLines.push(`${kw}${alias} = ${original};`)
          } else {
            // 单文件 compile：宿主 __import loader 返回 {last, named} 模块记录
            topLines.push(
              `${kw}${alias} = (await __import(${JSON.stringify(maybeImport.path)})).named[${JSON.stringify(original)}];`,
            )
          }
        }
      }

      // 类型导入（path 之后）：#import 'p' { T as U }
      if (maybeImport.types) {
        for (const item of maybeImport.types.items) {
          const original = item.name
          const alias = item.alias ?? original
          if (ctx && depI != null && spec != null) {
            emitTypeImport(original, alias, spec)
          }
          // 单文件 compile：类型运行时无值，不产生代码
        }
      }
      continue
    }
    switch (st.$type) {
      case 'Assignment': {
        // 同名重复绑定（objects.ooc 里 calc 两次赋值）用重赋，保持 JS let 语义合法
        const kw = bound.has(st.name) ? '' : 'let '
        bound.add(st.name)
        pushDecl(st.name)
        topLines.push(
          `${kw}${st.name}${typeAnnot(st.typeAnnotation)} = ${expressionCode(st.expression)};`,
        )
        break
      }
      case 'TypeDef':
        // 类型定义：纯编译期形状，运行时无副作用；提升到模块顶层作 type 声明（可导出供 TS 使用）
        typeLines.push(typeDefCode(st))
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
  const typeMount = typeLines.join('\n')
  // 所有顶层绑定写回 __oocNamed 包（顺序即声明顺序），供命名导入方取用
  const bagFill = declNames
    .map((n) => `  __oocNamed[${JSON.stringify(n)}] = ${n};`)
    .join('\n')

  // 项目 build：外置共享 runtime + 依赖模块 ES import（模块图交付 vite/tsc）
  if (ctx) {
    // 只 import 本模块真正用到的 runtime 辅助（不触发 example 的 noUnusedLocals）
    const usedRuntime = ['__send', '__createObject']
      .map((name) => (new RegExp(`\\b${name}\\(`).test(body) ? name : null))
      .filter((n): n is string => n != null)
    const runtimeImport = usedRuntime.length > 0
      ? `import { ${usedRuntime.join(', ')} } from '${ctx.runtimeImport}';`
      : ''
    // 只有真正执行的依赖才 import 其默认导出（纯类型导入不加载模块，无副作用）
    const depImports = Array.from(depRunVar.keys())
      .sort((a, b) => a - b)
      .map((i) => `import _m${i} from '${ctx.deps[i].specifier}';`)
      .join('\n')
    const header = [
      runtimeImport,
      depImports,
      bagImports.join('\n'),
      esmNamedImports.join('\n'),
      typeImportLines.join('\n'),
    ]
      .filter(Boolean)
      .join('\n')
    return `${header}
${typeMount}
// ---- 编译产物 ----
export const __oocNamed: Record<string, any> = {}
export async function run(globals: Record<string, any> = {}): Promise<any> {
  let __last: any = null
${hostDecls}
  ${body}
${bagFill}
  return __last
}
export default run
`
  }

  // 单文件 compile：内联运行时 + 宿主 __import loader（自包含）
  return `${OOC_RUNTIME_SNIPPET}
${typeMount}
// ---- 编译产物 ----
export async function run(globals: Record<string, any> = {}, onImport?: (path: string) => any): Promise<any> {
  let __last: any = null
  // __import 归一化：loader 可返回 {last, named} 模块记录，也可直接返回模块默认导出
  const __import = async (path: string) => {
    const raw = (globals && typeof globals.__import === 'function')
      ? await globals.__import(path)
      : await (onImport ?? (() => { throw new Error('OOC import 未解析: ' + path) }))(path)
    return (raw && typeof raw === 'object' && 'last' in raw && 'named' in raw)
      ? raw
      : { last: raw, named: {} }
  }
${hostDecls}
  ${body}
${bagFill}
  return __last
}
export default run
export const __oocNamed: Record<string, any> = {}
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