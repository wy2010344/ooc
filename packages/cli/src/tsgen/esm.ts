// .ooc 模块图 → 纯 ES 模块产物（`ooc build` 与 vite-plugin-ooc 共用）。
//
// 语义对齐解释器 interpret：OOC 里所有顶层声明都是模块 export，#import 与 TS import
// 完全等价——
//   x = #import 'm'              → import x from '<m>'
//   #import { a as b, c } 'm'    → import { a as b, c } from '<m>'（类型项走 import type）
//   #import 'm' { T as U }       → import type { T as U } from '<m>'
// 模块在 ES 导入时按其依赖顺序自动执行（解释器也是先执行全部 #import 再跑模块体），
// 宿主 globals 改成静态 import（import __globals from '<globals>'），不再逐层线程传递。
import type { Model } from 'object-oriented-c-language'
import { collectHostRefs, expressionCode, typeAnnot, typeDefCode } from './helpers.js'

/** 项目 build 的依赖：path 是 AST 里的 #import 原值，specifier 是 ES import 目标（相对本产物）。 */
export type ModuleDep = {
  path: string
  specifier: string
  /** 依赖模块的类型导出（typedef/#type 名）：命名导入用它区分「类型」与「值」 */
  typeNames?: string[]
}

export type EsmContext = {
  runtimeImport: string
  globalsImport: string
  deps: ModuleDep[]
}

export function emitEsmModule(model: Model, ctx: EsmContext): string {
  // fail-fast：ctx 不全会静默产出 `import ... from 'undefined'` 这种坏代码。
  // 最常见成因是编译产物新旧混搭（如 vite-plugin-ooc 的 out/ 还是旧版），
  // 根因一般是漏跑 `npm run build`（out/ 不入库，git pull 不会更新它）。
  if (!ctx.runtimeImport || !ctx.globalsImport) {
    throw new Error(
      'ooc codegen 缺少 runtimeImport/globalsImport 上下文；请在工作区根目录执行 npm run build 重新编译各包 out/（out/ 被 gitignore，git pull 不会更新）',
    )
  }
  const depIndex = new Map<string, number>()
  ctx.deps.forEach((d, i) => depIndex.set(d.path, i))
  const specFor = (path: string) =>
    ctx.deps[depIndex.get(path) ?? -1]?.specifier ?? path
  const typeNamesFor = (path: string) =>
    ctx.deps[depIndex.get(path) ?? -1]?.typeNames ?? []

  // 预扫描：顶层赋值（同名多次 → let 重绑）、typedef 名、最后一条表达式（默认导出）
  const assignCount = new Map<string, number>()
  const typedefNames = new Set<string>()
  let lastExprIndex = -1
  model.expressions.forEach((st, i) => {
    switch (st.$type) {
      case 'Assignment':
        assignCount.set(st.name, (assignCount.get(st.name) ?? 0) + 1)
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
  const rebound = new Set(
    [...assignCount].filter(([, n]) => n > 1).map(([name]) => name),
  )

  // 值/类型两个命名空间分别跟踪占用（同名 type 与 value 在 TS 里可并存）。
  // import 绑定与顶层赋值重名时不能直接 import（会撞声明/赋值），
  // 改成 import 一个 _oocImp_ 私有名再桥接回原名。
  const valueTaken = new Set<string>(assignCount.keys())
  const typeTaken = new Set<string>(typedefNames)
  const declared = new Set<string>()
  const bridges: string[] = []
  /** 导入绑定的 OOC 可见名（默认导入名 / 命名导入别名）：本模块的顶层声明，需要再导出 */
  const importBindingNames: string[] = []
  const reserve = (
    alias: string,
    taken: Set<string>,
    kind: 'value' | 'type',
  ): string => {
    if (!taken.has(alias)) {
      taken.add(alias)
      return alias
    }
    let id = `_oocImp_${alias}`
    let n = 2
    while (taken.has(id)) {
      id = `_oocImp_${alias}${n++}`
    }
    taken.add(id)
    declared.add(alias)
    bridges.push(kind === 'type' ? `type ${alias} = ${id};` : `let ${alias} = ${id};`)
    return id
  }

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
      defaultImports.push(`import ${reserve(st.name, valueTaken, 'value')} from '${spec}';`)
      importBindingNames.push(st.name)
    }
    if (st.named) {
      for (const item of st.named.items) {
        const original = item.name
        const alias = item.alias ?? original
        const isType = typeNamesFor(st.path).includes(original)
        const target = isType ? typeImports : valueImports
        const clauses = target.get(spec) ?? []
        const id = reserve(alias, isType ? typeTaken : valueTaken, isType ? 'type' : 'value')
        clauses.push(id === original ? original : `${original} as ${id}`)
        target.set(spec, clauses)
        importBindingNames.push(alias)
      }
    }
    if (st.types) {
      for (const item of st.types.items) {
        const original = item.name
        const alias = item.alias ?? original
        const clauses = typeImports.get(spec) ?? []
        const id = reserve(alias, typeTaken, 'type')
        clauses.push(id === original ? original : `${original} as ${id}`)
        typeImports.set(spec, clauses)
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
        if (declared.has(st.name)) {
          bodyLines.push(`${st.name} = ${code};`)
          return
        }
        declared.add(st.name)
        bodyExports.add(st.name)
        const kw = rebound.has(st.name) ? 'let' : 'const'
        bodyLines.push(
          `export ${kw} ${st.name}${typeAnnot(st.typeAnnotation)} = ${code};`,
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

  // 导入绑定也是本模块顶层声明：与赋值/typedef 不重名的一并再导出（去重）
  const reExports = [...new Set(importBindingNames)].filter(
    (name) => !bodyExports.has(name) && !typedefNames.has(name),
  )
  if (reExports.length > 0) {
    bodyLines.push(`export { ${reExports.join(', ')} };`)
  }

  const hostRefs = collectHostRefs(model, valueTaken)
  const body = [...bridges, ...bodyLines].join('\n')
  // 只 import 本模块真正用到的 runtime 辅助（不触发 example 的 noUnusedLocals）
  const usedRuntime = ['__send', '__createObject', '__globalsOf']
    .map((name) =>
      new RegExp(`\\b${name}\\(`).test(bodyLines.join('\n')) ||
      (name === '__globalsOf' && hostRefs.length > 0)
        ? name
        : null,
    )
    .filter((n): n is string => n != null)
  const header = [
    usedRuntime.length > 0
      ? `import { ${usedRuntime.join(', ')} } from '${ctx.runtimeImport}';`
      : '',
    hostRefs.length > 0 ? `import __globals from '${ctx.globalsImport}';` : '',
    ...hostRefs.map((n) => `const ${n} = __globalsOf(__globals, ${JSON.stringify(n)});`),
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
