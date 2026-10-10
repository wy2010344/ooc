// Model → TS 代码生成。两种产物形态：
//  - 项目 build（ctx 提供 runtimeImport/globalsImport/deps）：纯 ES 模块——所有顶层声明
//    即 export，#import 编译成与 TS import 等价的真 ES import，模块在图里按依赖顺序执行。
//    见 esm.ts（`ooc build` / vite-plugin-ooc 共用）。
//  - 单文件 compile（无 ctx）：内联运行时辅助 + export function run(globals, onImport)，
//    import 走 __import loader，产物自包含可被任意宿主加载执行。
import type { Model } from 'object-oriented-c-language'
import { OOC_RUNTIME_SNIPPET } from './runtime-template.js'
import { expressionCode } from './expr.js'
import { collectHostRefs, typeAnnot, typeDefCode } from './helpers.js'
import { emitEsmModule, type EsmContext } from './esm.js'

export type { EsmContext, ModuleDep } from './esm.js'

/** 项目 build 复用上下文（纯 ES 产物形态）。 */
export type ReuseContext = EsmContext

export function modelToTs(model: Model, ctx?: ReuseContext): string {
  if (ctx) {
    return emitEsmModule(model, ctx)
  }
  return compileToStandaloneModule(model)
}

/** 单文件 compile：自包含模块（内联运行时 + __import loader）。 */
function compileToStandaloneModule(model: Model): string {
  const topLines: string[] = []
  const typeLines: string[] = []
  const bound = new Set<string>()
  const declNames: string[] = []
  const declSeen = new Set<string>()

  const pushDecl = (name: string) => {
    if (!declSeen.has(name)) {
      declSeen.add(name)
      declNames.push(name)
    }
  }

  for (const st of model.expressions) {
    switch (st.$type) {
      case 'ImportStatement': {
        // 默认导入：模块默认导出（最后一条表达式的结果）
        if (st.name) {
          const kw = bound.has(st.name) ? '' : 'let '
          bound.add(st.name)
          pushDecl(st.name)
          topLines.push(
            `${kw}${st.name} = (await __import(${JSON.stringify(st.path)})).last;`,
          )
        }
        // 命名导入：绑定模块对应的顶层声明
        if (st.named) {
          for (const item of st.named.items) {
            const alias = item.alias ?? item.name
            const kw = bound.has(alias) ? '' : 'let '
            bound.add(alias)
            pushDecl(alias)
            topLines.push(
              `${kw}${alias} = (await __import(${JSON.stringify(st.path)})).named[${JSON.stringify(item.name)}];`,
            )
          }
        }
        // types 类型导入运行时无值，不产生代码
        break
      }
      case 'Assignment': {
        // 同名重复绑定用重赋，保持 JS let 语义合法
        const kw = bound.has(st.name) ? '' : 'let '
        bound.add(st.name)
        pushDecl(st.name)
        topLines.push(
          `${kw}${st.name}${typeAnnot(st.typeAnnotation)} = ${expressionCode(st.expression)};`,
        )
        break
      }
      case 'TypeDef':
        typeLines.push(typeDefCode(st))
        break
      default:
        topLines.push(`__last = ${expressionCode(st as any)};`)
        break
    }
  }

  // 宿主 globals 引用收集：未在当前模块绑定、也不是语言内建的名字 → 从 run(globals) 注入
  const hostDecls = collectHostRefs(model, bound)
    .map((name) => `  const ${name} = globals[${JSON.stringify(name)}];`)
    .join('\n')

  const body = topLines.join('\n  ')
  // 所有顶层绑定写回 __oocNamed 包（顺序即声明顺序），供命名导入方取用
  const bagFill = declNames
    .map((n) => `  __oocNamed[${JSON.stringify(n)}] = ${n};`)
    .join('\n')

  return `${OOC_RUNTIME_SNIPPET}
${typeLines.join('\n')}
// ---- 编译产物 ----
export const __oocNamed: Record<string, any> = {}
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
export const runtime = { __send, __createObject }
`
}
