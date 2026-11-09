// OOC vite 插件：让 '.ooc' 成为一等源码模块，像 .vue SFC 一样被打包器直接识别——
//   - TS/JS 可直接 `import app from './app.ooc'`（插件 transform 成纯 ES 模块：默认导出 =
//     模块最后一条表达式，所有顶层声明都是 export）
//   - .ooc 内 `#import './math.ooc'` / `#import './helper.ts'` 编译成与 TS import 等价的
//     真 ES import（进 vite 模块图），模块按依赖顺序自动执行
// 实现要点：
//   - dev 与 build 都走 插件 resolveId（归一化为真实绝对路径）+ load（读磁盘 transform）。
//     （不能只靠 transform 钩子：vite dev 只对 JS 系扩展名调用它，.ooc 会被当静态文件原样返回）
//   - .ooc 用真实路径做模块 id：vite 的模块图 key、文件监听/HMR、URL 映射全部原生可用。
//   - 共享 runtime / 宿主 globals 走虚拟模块（virtual:ooc-runtime / virtual:ooc-globals），
//     bundle 各只留一份，无磁盘中间产物、无 prebuild。宿主 globals 用 options.globals 指定。
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import type { Plugin } from 'vite'
import { URI } from 'langium'
import {
  modelToTs,
  OOC_RUNTIME_MODULE,
  resolveImportSource,
  typeExportNames,
  tsTypeExportNames,
} from 'object-oriented-c-cli'
import type { Model } from 'object-oriented-c-language'
import {
  createObjectOrientedCServices,
  graftTemplates,
  makeHoleParser,
} from 'object-oriented-c-language'
import { NodeFileSystem } from 'langium/node'
import {
  createImportRefChecker,
  checkLocalUndefinedRefs,
  configGlobalNames,
} from './import-refs.js'

/** 共享运行时虚拟模块 id：各 .ooc 产物从它 import __send/__mutable，bundle 只保留一份。 */
export const OOC_RUNTIME_VIRTUAL_ID = 'virtual:ooc-runtime'
const RESOLVED_RUNTIME_ID = '\u0000' + OOC_RUNTIME_VIRTUAL_ID

// runtime 模板本身带 TS 类型，转成 JS 给虚拟模块（typescript.transpileModule 纯 JS，Termux 可用）
const RUNTIME_JS = ts
  .transpileModule(OOC_RUNTIME_MODULE, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText

export interface OocPluginOptions {
  /** 宿主注入、源码里不写 #import 也能用的全局名（如 playground 预载库） */
  globals?: string[]
}

/** 创建 OOC 一等模块 vite 插件。 */
export function oocPlugin(options: OocPluginOptions = {}): Plugin {
  // 共享 langium 服务（只用于 parse 单个 .ooc，不做 linking/validation）
  const services = createObjectOrientedCServices(NodeFileSystem)
  // 模版字符串：fromString 不经 DocumentBuilder，需在此手动 graft 洞内表达式。
  const parseHole = makeHoleParser((source) =>
    services.ObjectOrientedC.parser.LangiumParser.parse(source),
  )
  let root = process.cwd()

  /** 把磁盘读到的当前源码 parse 成 Model（同步、不走文档缓存，天然响应热更新）。 */
  function parseModel(code: string, id: string): Model {
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(code, URI.file(id))
    const parseErrors = (doc.parseResult.parserErrors ?? []).map(
      (e: any) => e.message ?? String(e),
    )
    if (parseErrors.length > 0) {
      throw new Error(`OOC 语法错误 ${parseErrors[0]}`)
    }
    const model = doc.parseResult.value as Model
    graftTemplates(model, parseHole)
    return model
  }

  /** 构建期未定义引用检查（导出名解析与缓存见 import-refs.ts） */
  const refChecker = createImportRefChecker(parseModel)

  /** #import 原值 → 相对当前 .ooc 模块的 ES import 说明符（带扩展名，vite 可直接解析）。 */
  function specifierFor(id: string, raw: string): string {
    const target = resolveImportSource(raw, id)
    let rel = path.relative(path.dirname(id), target).replace(/\\/g, '/')
    if (!rel.startsWith('.')) rel = './' + rel
    return rel
  }

  // 依赖模块解析缓存：命名导入需区分类型/值导出（.ooc 解析 AST、.ts 扫声明）
  // 一律以真实绝对路径为 key，文件改动时由 handleHotUpdate 精确清掉（见下）
  const depModelCache = new Map<string, Model>()
  const depTypeNameCache = new Map<string, string[]>()
  /** 模块 → 它 #import 的真实路径；重编译时要先撤销旧的反向登记 */
  const importsBy = new Map<string, Set<string>>()
  /** 依赖目标 → 引用它的模块；目标改动时让这些模块一起失效 */
  const importers = new Map<string, Set<string>>()
  function depTypeNames(fromId: string, raw: string): string[] {
    const target = resolveImportSource(raw, fromId)
    if (target.endsWith('.ts') || target.endsWith('.js') || target.endsWith('.mjs')) {
      // 与 CLI build 共用同一套扫描，避免两边对 export type/interface 的判定漂移
      return tsTypeExportNames(fs.readFileSync(target, 'utf8'))
    }
    let names = depTypeNameCache.get(target)
    if (!names) {
      let model = depModelCache.get(target)
      if (!model) {
        model = parseModel(fs.readFileSync(target, 'utf8'), target)
        depModelCache.set(target, model)
      }
      names = typeExportNames(model)
      depTypeNameCache.set(target, names)
    }
    return names
  }

  /** 重编译时刷新「目标 → 引用方」反向表，避免旧依赖残留导致多余/漏失效 */
  function recordDeps(id: string, deps: readonly string[]): void {
    const old = importsBy.get(id)
    if (old) {
      for (const dep of old) importers.get(dep)?.delete(id)
    }
    const next = new Set(deps)
    importsBy.set(id, next)
    for (const dep of next) {
      let owners = importers.get(dep)
      if (!owners) {
        owners = new Set()
        importers.set(dep, owners)
      }
      owners.add(id)
    }
  }

  /** .ooc 源码 → JS 模块（modelToTs 纯 ES 形态 + transpileModule 剥类型，保留真 ES import）。 */
  function compile(
    oocSource: string,
    realAbs: string,
  ): { code: string; deps: string[] } {
    const model = parseModel(oocSource, realAbs)
    // config.ooc 自身不是运行时模块，且 globals 的 RHS 故意引用注入的宿主名，跳过
    if (path.basename(realAbs) !== 'config.ooc') {
      const globals = [...configGlobalNames(realAbs), ...(options.globals ?? [])]
      checkLocalUndefinedRefs(model, realAbs, globals)
    }
    const imports = (model.expressions as any[]).filter(
      (st) => st.$type === 'ImportStatement',
    )
    const deps: string[] = []
    const esmDeps = imports.map((st) => {
      refChecker.check(realAbs, st)
      try {
        deps.push(resolveImportSource(st.path, realAbs))
      } catch {
        // 解析失败的路径交给 vite 的模块解析报错，不在这里抢跑
      }
      return {
        path: st.path as string,
        specifier: specifierFor(realAbs, st.path),
        typeNames: depTypeNames(realAbs, st.path),
      }
    })
    const tsCode = modelToTs(model, {
      runtimeImport: OOC_RUNTIME_VIRTUAL_ID,
      deps: esmDeps,
    })
    const js = ts
      .transpileModule(tsCode, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          isolatedModules: true,
          // 逐字保留 import：OOC 模块导入即有执行语义（顶层副作用），
          // 不许 TS 把「绑定了但没用」的 import 摇掉。类型导入已由发射器显式标 import type。
          verbatimModuleSyntax: true,
        },
      })
      .outputText
    return { code: js, deps }
  }

  return {
    name: 'vite-plugin-ooc',
    enforce: 'pre',

    configResolved(config) {
      root = config.root
    },

    resolveId(source, importer) {
      if (source === OOC_RUNTIME_VIRTUAL_ID) {
        return RESOLVED_RUNTIME_ID
      }
      // 相对/绝对 .ooc 引用（来自用户 TS 或编译产物的真 ES import）归一化为真实绝对路径，
      // 交给 load 钩子 transform 成 JS（.ooc 不在 vite 的 JS 扩展名列表里）
      if (source.endsWith('.ooc')) {
        // 注意：win32 的 path.isAbsolute('/x') 为 true（盘符根相对），不能直接当绝对路径；
        // 只有带盘符（C:/...）才是真绝对，'/src/...' 这类 dev URL 应按 root 拼接。
        // 浏览器侧的外部文件模块会以 vite 的 '/@fs/C:/...' 形式回传，必须先剥掉前缀。
        const FS_PREFIX = '/@fs/'
        const hasDrive = /^[a-zA-Z]:[\\/]/.test(source)
        let abs: string
        if (source.startsWith(FS_PREFIX)) {
          abs = source.slice(FS_PREFIX.length)
        } else if (path.isAbsolute(source) && hasDrive) {
          abs = source
        } else if (source.startsWith('/') || source.startsWith('\\')) {
          abs = path.join(root, source) // dev URL/root 相对 → root 下
        } else {
          const importerReal = importer ?? undefined
          abs = path.resolve(path.dirname(importerReal ?? path.join(root, 'index.html')), source)
        }
        return path.normalize(abs)
      }
      return undefined
    },

    load(id) {
      if (id === RESOLVED_RUNTIME_ID) {
        return { code: RUNTIME_JS }
      }
      if (!id.endsWith('.ooc')) return undefined
      // 每次 load 都从磁盘重读（不缓存 source → model）
      const { code, deps } = compile(fs.readFileSync(id, 'utf8'), id)
      // root 之外的 .ooc（浏览器以 /@fs/... 引用）不在 vite 默认 watch 范围内，
      // 必须显式登记自己和 #import 目标，否则改了文件不失效、要重启 dev server。
      const ctx = this as any
      ctx?.addWatchFile?.(id)
      for (const dep of deps) ctx?.addWatchFile?.(dep)
      recordDeps(id, deps)
      return { code }
    },

    handleHotUpdate(ctx) {
      const file = path.normalize(ctx.file)
      // 依赖的导出名 / 类型名可能变了，解析缓存按文件精确失效
      depModelCache.delete(file)
      depTypeNameCache.delete(file)
      refChecker.invalidate(file)
      const owners = importers.get(file)
      if (!owners || owners.size === 0) return undefined
      const graph = (ctx.server as any)?.moduleGraph
      const extra: any[] = []
      for (const id of owners) {
        const mod = graph?.getModuleById?.(id)
        if (mod && !(ctx.modules as any[]).includes(mod)) extra.push(mod)
      }
      // 连坐：引用方也 invalidate，重新 load 时才会重算 import 形态与导出检查
      return extra.length > 0 ? [...ctx.modules, ...extra] : undefined
    },
  }
}
