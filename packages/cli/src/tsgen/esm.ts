// .ooc 模块图 → 纯 ES 模块产物（`ooc build` 与 vite-plugin-ooc 共用）。
//
// 语义对齐解释器 interpret：OOC 里所有顶层声明都是模块 export，#import 与 TS import
// 完全等价——
//   x = #import 'm'              → import x from '<m>'
//   #import { a as b, c } 'm'    → import { a as b, c } from '<m>'（类型项走 import type）
//   #import 'm' { T as U }       → import type { T as U } from '<m>'
//   #import 'm';                 → import '<m>';（纯副作用导入，模块必执行）
// 模块在 ES 导入时按其依赖顺序自动执行（解释器也是先执行全部 #import 再跑模块体）。
// 宿主依赖（视图/信号/存储等）没有特殊待遇：和其它 TS 模块一样 `#import` 进来，
// 产物里就是普通 import；浏览器全局（document/window/console）本来就是自由标识符。
// 重复的底层辅助（__send/__mutable）从共享 runtime 外部导入。
import type { Model } from 'object-oriented-c-language'
import { AstUtils } from 'langium'
import { expressionCode, typeAnnot, typeDefCode } from './helpers.js'

/** 项目 build 的依赖：path 是 AST 里的 #import 原值，specifier 是 ES import 目标（相对本产物）。 */
export type ModuleDep = {
  path: string
  specifier: string
  /** 依赖模块的类型导出（typedef/#type 名）：命名导入用它区分「类型」与「值」 */
  typeNames?: string[]
}

export type EsmContext = {
  runtimeImport: string
  deps: ModuleDep[]
}

export function emitEsmModule(model: Model, ctx: EsmContext): string {
  // fail-fast：ctx 不全会静默产出 `import ... from 'undefined'` 这种坏代码。
  // 最常见成因是编译产物新旧混搭（如 vite-plugin-ooc 的 out/ 还是旧版），
  // 根因一般是漏跑 `npm run build`（out/ 不入库，git pull 不会更新它）。
  if (!ctx.runtimeImport) {
    throw new Error(
      'ooc codegen 缺少 runtimeImport 上下文；请在工作区根目录执行 npm run build 重新编译各包 out/（out/ 被 gitignore，git pull 不会更新）',
    )
  }
  const depIndex = new Map<string, number>()
  ctx.deps.forEach((d, i) => depIndex.set(d.path, i))
  const specFor = (path: string) =>
    ctx.deps[depIndex.get(path) ?? -1]?.specifier ?? path
  const typeNamesFor = (path: string) =>
    ctx.deps[depIndex.get(path) ?? -1]?.typeNames ?? []

  // 预扫描：typedef 名、最后一条表达式（默认导出）。
  // 顶层同名声明是 validator 的 duplicateDeclaration（绑定都是 const），这里不再做重绑/桥接
  const typedefNames = new Set<string>()
  let lastExprIndex = -1
  model.expressions.forEach((st, i) => {
    switch (st.$type) {
      case 'Assignment':
        break
      case 'TypeDef':
        typedefNames.add(st.name)
        break
      case 'ImportStatement':
        break
      default:
        lastExprIndex = i
    }
  })

  /** 导入绑定的 OOC 可见名（默认导入名 / 命名导入别名）：本模块的顶层声明，需要再导出 */
  const importBindingNames: string[] = []
  /** 其中只作为类型导入的绑定：再导出必须用 `export type`（verbatimModuleSyntax） */
  const typeBindingNames = new Set<string>()

  // 预扫描：命名空间类型 `ns#Name` 的用点（类型位要 `ns$ns.Name`，
  // esm 头部按用点补发 `import * as ns$ns from '<同一模块>'`；值侧仍走默认导入）
  const nsUsages = new Set<string>()
  for (const node of AstUtils.streamAst(model)) {
    const ns = (node as any).ns
    if (node.$type === 'TypeName' && typeof ns === 'string' && ns) {
      nsUsages.add(ns)
    }
  }
  const nsImported = new Set<string>()

  // 第一遍：只处理 import 语句，产出 ES import 头与桥接绑定
  const defaultImports: string[] = []
  const valueImports = new Map<string, string[]>()
  const typeImports = new Map<string, string[]>()
  /** 无绑定 import（纯副作用导入）：`#import 'mod';` —— 模块必须执行，不能被摇树掉 */
  const sideEffectImports = new Set<string>()
  for (const st of model.expressions) {
    if (st.$type !== 'ImportStatement') continue
    const spec = specFor(st.path)
    if (!st.name && !st.named && !st.types) {
      sideEffectImports.add(spec)
      continue
    }
    if (st.name) {
      defaultImports.push(`import ${st.name} from '${spec}';`)
      importBindingNames.push(st.name)
    }
    if (st.named) {
      for (const item of st.named.items) {
        const original = item.name
        const alias = item.alias ?? original
        const isType = typeNamesFor(st.path).includes(original)
        const target = isType ? typeImports : valueImports
        const clauses = target.get(spec) ?? []
        clauses.push(alias === original ? original : `${original} as ${alias}`)
        target.set(spec, clauses)
        importBindingNames.push(alias)
        if (isType) typeBindingNames.add(alias)
      }
    }
    if (st.types) {
      for (const item of st.types.items) {
        const original = item.name
        const alias = item.alias ?? original
        const clauses = typeImports.get(spec) ?? []
        clauses.push(alias === original ? original : `${original} as ${alias}`)
        typeImports.set(spec, clauses)
        importBindingNames.push(alias)
        typeBindingNames.add(alias)
      }
    }
  }

  // 命名空间类型用点补发 `ns$ns` 命名空间导入（按绑定名匹配，默认/命名/类型导入皆可）
  if (nsUsages.size > 0) {
    for (const st of model.expressions) {
      if (st.$type !== 'ImportStatement') continue
      const spec = specFor(st.path)
      const bindings: string[] = []
      if (st.name) bindings.push(st.name)
      if (st.named) {
        for (const item of st.named.items) bindings.push(item.alias ?? item.name)
      }
      if (st.types) {
        for (const item of st.types.items) bindings.push(item.alias ?? item.name)
      }
      for (const b of bindings) {
        if (!nsUsages.has(b) || nsImported.has(b)) continue
        nsImported.add(b)
        defaultImports.push(`import * as ${b}$ns from '${spec}';`)
      }
    }
  }

  // 第二遍：模块体（顶层声明全导出）
  const bodyLines: string[] = []
  const typeLines: string[] = []
  const bodyExports = new Set<string>()
  model.expressions.forEach((st, i) => {
    switch (st.$type) {
      case 'ImportStatement':
        return // import 已在头部/桥接处处理
      case 'Assignment': {
        const code = expressionCode(st.expression)
        bodyExports.add(st.name)
        bodyLines.push(
          `export const ${st.name}${typeAnnot(st.typeAnnotation)} = ${code};`,
        )
        return
      }
      case 'TypeDef':
        typeLines.push(typeDefCode(st))
        return
      default: {
        const code = expressionCode(st as any)
        // 对象字面量在语句位要包括号，避免被解析成块
        const stmt = code.startsWith('{') ? `(${code})` : code
        bodyLines.push(i === lastExprIndex ? `export default ${stmt};` : `${stmt};`)
        return
      }
    }
  })
  if (lastExprIndex === -1) {
    bodyLines.push('export default null;')
  }

  // 导入绑定也是本模块顶层声明：与赋值/typedef 不重名的一并再导出（去重）。
  // 类型绑定必须走 `export type`，否则 verbatimModuleSyntax 报 TS1205。
  const freeBindings = [...new Set(importBindingNames)].filter(
    (name) => !bodyExports.has(name) && !typedefNames.has(name),
  )
  const typeReExports = freeBindings.filter((name) => typeBindingNames.has(name))
  const valueReExports = freeBindings.filter((name) => !typeBindingNames.has(name))
  if (valueReExports.length > 0) {
    bodyLines.push(`export { ${valueReExports.join(', ')} };`)
  }
  if (typeReExports.length > 0) {
    bodyLines.push(`export type { ${typeReExports.join(', ')} };`)
  }

  const body = bodyLines.join('\n')
  // 只 import 本模块真正用到的 runtime 辅助（不触发 example 的 noUnusedLocals）
  const usedRuntime = ['__send', '__spread', '__mutable']
    .map((name) =>
      new RegExp(`\\b${name}\\(`).test(bodyLines.join('\n')) ? name : null,
    )
    .filter((n): n is string => n != null)
  const header = [
    usedRuntime.length > 0
      ? `import { ${usedRuntime.join(', ')} } from '${ctx.runtimeImport}';`
      : '',
    ...[...sideEffectImports].map((spec) => `import '${spec}';`),
    ...[...typeImports].map(
      ([spec, clauses]) => `import type { ${clauses.join(', ')} } from '${spec}';`,
    ),
    ...[...valueImports].map(
      ([spec, clauses]) => `import { ${clauses.join(', ')} } from '${spec}';`,
    ),
    defaultImports.join('\n'),
  ]
    .filter(Boolean)
    .join('\n')

  return `${header}
${typeLines.join('\n')}
// ---- 编译产物 ----
${body}
`
}
