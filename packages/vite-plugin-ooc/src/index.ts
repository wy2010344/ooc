// OOC vite 插件：让 '.ooc' 成为一等源码模块，像 .vue SFC 一样被打包器直接识别——
//   - TS/JS 可直接 `import app from './app.ooc'`（插件 transform 成 JS，默认导出 run(globals)）
//   - .ooc 内 `#import './math.ooc'` / `#import './helper.ts'` 编译成真 ES import（进 vite 模块图）
// 对比 ooc build 的磁盘产物树：本插件只在内存 transform，无中间产物、无 prebuild、
// 共享 runtime 走虚拟模块（virtual:ooc-runtime），模块图单一普通。
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

  /** 把 transform 收到的当前源码 parse 成 Model（同步、不走文档缓存，天然响应热更新）。 */
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

  return {
    name: 'vite-plugin-ooc',
    enforce: 'pre',

    configResolved(config) {
      root = config.root
    },

    resolveId(id) {
      if (id === OOC_RUNTIME_VIRTUAL_ID) {
        return RESOLVED_RUNTIME_ID
      }
      return undefined
    },

    load(id) {
      if (id === RESOLVED_RUNTIME_ID) {
        return { code: RUNTIME_JS }
      }
      return undefined
    },

    transform(code, id) {
      if (!id.endsWith('.ooc')) {
        return undefined
      }
      const model = parseModel(code, id)
      const deps = collectImports(model).map((raw) => ({
        path: raw,
        specifier: specifierFor(id, raw),
      }))
      const tsCode = modelToTs(model, {
        runtimeImport: OOC_RUNTIME_VIRTUAL_ID,
        deps,
      })
      // OOC 不是 TS：transform 必须吐纯 JS，用 transpileModule 剥类型（保留真 ES import）
      const js = ts
        .transpileModule(tsCode, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            isolatedModules: true,
          },
        })
        .outputText
      return { code: js, map: null }
    },
  }
}