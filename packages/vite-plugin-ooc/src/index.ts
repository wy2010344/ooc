// OOC vite 插件：让 '.ooc' 成为一等源码模块，像 .vue SFC 一样被打包器直接识别——
//   - TS/JS 可直接 `import app from './app.ooc'`（插件 transform 成 JS，默认导出 run(globals)）
//   - .ooc 内 `#import './math.ooc'` / `#import './helper.ts'` 编译成真 ES import（进 vite 模块图）
// 实现要点：
//   - dev 与 build 都走 插件 resolveId（归一化为真实绝对路径）+ load（读磁盘 transform）。
//     （不能只靠 transform 钩子：vite dev 只对 JS 系扩展名调用它，.ooc 会被当静态文件原样返回）
//   - .ooc 用真实路径做模块 id：vite 的模块图 key、文件监听/HMR、URL 映射全部原生可用。
//   - 共享 runtime 走虚拟模块（virtual:ooc-runtime），bundle 只留一份，无磁盘中间产物、无 prebuild。
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import type { Plugin } from 'vite'
import { URI } from 'langium'
import {
  modelToTs,
  OOC_RUNTIME_MODULE,
  resolveImportSource,
  collectImports,
} from 'object-oriented-c-cli'
import type { Model } from 'object-oriented-c-language'
import { createObjectOrientedCServices } from 'object-oriented-c-language'
import { NodeFileSystem } from 'langium/node'

/** 共享运行时虚拟模块 id：各 .ooc 产物从它 import __send/__createObject，bundle 只保留一份。 */
export const OOC_RUNTIME_VIRTUAL_ID = 'virtual:ooc-runtime'
const RESOLVED_RUNTIME_ID = '\u0000' + OOC_RUNTIME_VIRTUAL_ID

// runtime 模板本身带 TS 类型，转成 JS 给虚拟模块（typescript.transpileModule 纯 JS，Termux 可用）
const RUNTIME_JS = ts
  .transpileModule(OOC_RUNTIME_MODULE, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText

export type OocPluginOptions = {
  /** 包安装目录（默认 <vite root>/.ooc_modules） */
  modulesDir?: string
}

/** 创建 OOC 一等模块 vite 插件。 */
export function oocPlugin(options: OocPluginOptions = {}): Plugin {
  // 共享 langium 服务（只用于 parse 单个 .ooc，不做 linking/validation）
  const services = createObjectOrientedCServices(NodeFileSystem)
  let root = process.cwd()
  let modulesDir: string | undefined

  /** 把磁盘读到的当前源码 parse 成 Model（同步、不走文档缓存，天然响应热更新）。 */
  function parseModel(code: string, id: string): Model {
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(code, URI.file(id))
    const parseErrors = (doc.parseResult.parserErrors ?? []).map(
      (e: any) => e.message ?? String(e),
    )
    if (parseErrors.length > 0) {
      throw new Error(`OOC 语法错误 ${parseErrors[0]}`)
    }
    return doc.parseResult.value as Model
  }

  /** #import 原值 → 相对当前 .ooc 模块的 ES import 说明符（带扩展名，vite 可直接解析）。 */
  function specifierFor(id: string, raw: string): string {
    const target = resolveImportSource(raw, id, modulesDir ?? path.join(root, '.ooc_modules'))
    let rel = path.relative(path.dirname(id), target).replace(/\\/g, '/')
    if (!rel.startsWith('.')) rel = './' + rel
    return rel
  }

  /** .ooc 源码 → JS 模块（modelToTs ctx 模式 + transpileModule 剥类型，保留真 ES import）。 */
  function compile(oocSource: string, realAbs: string): { code: string } {
    const model = parseModel(oocSource, realAbs)
    const deps = collectImports(model).map((raw) => ({
      path: raw,
      specifier: specifierFor(realAbs, raw),
    }))
    const tsCode = modelToTs(model, { runtimeImport: OOC_RUNTIME_VIRTUAL_ID, deps })
    const js = ts
      .transpileModule(tsCode, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          isolatedModules: true,
        },
      })
      .outputText
    return { code: js }
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
        // 只有带盘符（C:/...）才是真绝对，'/src/...' 这类 dev URL 应按 root 拼接
        const hasDrive = /^[a-zA-Z]:[\\/]/.test(source)
        let abs: string
        if (path.isAbsolute(source) && hasDrive) {
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
      if (id.endsWith('.ooc')) {
        // 每次 load 都从磁盘重读；vite 文件监听该真实路径，改动自动失效并重新加载（热更新）
        return compile(fs.readFileSync(id, 'utf8'), id)
      }
      return undefined
    },
  }
}