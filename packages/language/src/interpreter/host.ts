import { AstNode, LangiumDocument, URI } from 'langium'
import { DefaultSharedModuleContext } from 'langium/lsp'
import { parseHelper } from 'langium/test'
import { run } from 'wy-helper'
import {
  codeOfDiagnostic,
  filterDiagnostic,
  loadOocConfig,
  type OocConfig,
} from '../diagnostics-config.js'
import { ImportStatement, isModel, Model } from '../generated/ast.js'
import { createObjectOrientedCServices } from '../object-oriented-c-module.js'
import {
  dirnameOf,
  extnameOf,
  joinPath,
  resolveModuleName,
  toPosix,
} from '../module-path.js'
import { interpret, type InterpretAction } from './evaluate.js'
import { type Globals, withGlobals } from './scope.js'

/**
 * 配置来源：显式传入，或 'auto'（从根目录 ooc.json 读取）。
 */
export type ConfigSource = OocConfig | 'auto' | undefined

/**
 * Node/CLI 当前工作目录；浏览器没有 process，返回空串（虚拟 FS 按 basename 查找模块）。
 */
function nodeCwd(): string {
  return typeof process !== 'undefined' && typeof process.cwd === 'function'
    ? process.cwd()
    : ''
}

/**
 * 绝对路径判断：POSIX 以 / 开头，Windows 盘符 C:/…（URI.file 会把这两者
 * 直接当绝对路径；相对路径则必须相对当前工作目录解析，否则会被当成根路径）。
 */
function isAbsolutePath(p: string): boolean {
  const posix = toPosix(p)
  return posix.startsWith('/') || /^[A-Za-z]:\//.test(posix)
}

/**
 * 解析入口文件路径：Node 下相对路径以当前工作目录为基准（URI.file 会把相对
 * 路径当成根路径，./demo.ooc 会被解析成 /demo.ooc）；绝对路径与浏览器保持原样。
 */
function resolveEntryFile(
  rawName: string,
  extensions: readonly string[],
): string {
  const cwd = nodeCwd()
  const fromPath = !isAbsolutePath(rawName) && cwd
    ? joinPath(cwd, 'entry.ooc')
    : ''
  return resolveModuleName(rawName, fromPath, extensions)
}

/**
 * 执行 OOC 模型的入口函数
 */
function executeOOC(
  model: Model,
  path: string,
  interpretAction: InterpretAction,
  globals: Globals,
) {
  return interpret(
    model,
    withGlobals(undefined, globals),
    path,
    interpretAction,
  )
}

const cacheInterpret = new Map<string, Promise<any>>()
export function createInterpretAction(
  context: DefaultSharedModuleContext,
  globals: Globals = {},
  config: ConfigSource = 'auto',
) {
  const services = createObjectOrientedCServices(context).ObjectOrientedC
  const parse = parseHelper(services)
  const fs = context.fileSystemProvider(services.shared)
  // ooc.json 配置：按根目录缓存
  let cachedConfig: OocConfig | undefined
  let cachedConfigRoot: string | undefined
  async function resolveConfig(rootPath: string): Promise<OocConfig> {
    if (config && config !== 'auto') {
      return config
    }
    if (cachedConfigRoot === rootPath) {
      return cachedConfig ?? {}
    }
    cachedConfigRoot = rootPath
    cachedConfig = await loadOocConfig(fs, rootPath)
    return cachedConfig ?? {}
  }
  function interpretPath(rawName: string) {
    let value = cacheInterpret.get(rawName)
    if (!value) {
      value = run(async () => {
        const extensions = services.LanguageMetaData.fileExtensions
        // 统一为 posix 路径；无扩展名的虚拟路径补默认扩展（Langium 按扩展名注册语言服务）
        const fileName = resolveEntryFile(rawName, extensions)
        const ext = extnameOf(fileName)
        if (ext && !extensions.includes(ext)) {
          throw `Please choose a file with one of these extensions: ${extensions}.`
        }
        const uri = URI.file(fileName)
        if (!fs.exists(uri)) {
          throw `File ${fileName} does not exist.`
        }
        const document =
          await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
            uri,
          )
        return execDocument(document, fileName)
      })
      cacheInterpret.set(rawName, value)
    }
    return value
  }

  /**
   * 预加载导入文档树（含递归导入），让静态类型解析器在文档校验期间
   * 能同步取到被导入模块的 AST。路径解析与校验器 createImportResolver 完全一致，
   * 都以 document.uri.path 为基准目录。
   */
  async function preloadImportTree(
    document: LangiumDocument<AstNode>,
    seen = new Set<string>(),
  ): Promise<void> {
    const model = document.parseResult.value
    if (!isModel(model)) {
      return
    }
    const docs = services.shared.workspace.LangiumDocuments
    const extensions = services.LanguageMetaData.fileExtensions
    for (const stmt of model.expressions) {
      if (stmt.$type !== 'ImportStatement') {
        continue
      }
      const importStmt = stmt as ImportStatement
      const fileName = resolveModuleName(
        importStmt.path,
        document.uri.path,
        extensions,
      )
      const ext = extnameOf(fileName)
      if (ext && !extensions.includes(ext)) {
        continue
      }
      if (seen.has(fileName) || !fs.existsSync(URI.file(fileName))) {
        continue
      }
      seen.add(fileName)
      const imported = await docs.getOrCreateDocument(URI.file(fileName))
      await preloadImportTree(imported, seen)
    }
  }

  async function execDocument(
    document: LangiumDocument<AstNode>,
    fileName: string,
  ) {
    await preloadImportTree(document)
    await services.shared.workspace.DocumentBuilder.build([document], {
      validation: true,
    })

    const resolved = await resolveConfig(dirnameOf(fileName))
    const validationErrors = (document.diagnostics ?? []).filter((e) => {
      const next = filterDiagnostic(resolved, e.severity, codeOfDiagnostic(e))
      return next === 1
    })
    if (validationErrors.length > 0) {
      throw (
        'There are validation errors:\n' +
        validationErrors
          .map(
            (validationError) =>
              `line ${validationError.range.start.line + 1}: ${validationError.message} [${document.textDocument.getText(validationError.range)}]`,
          )
          .join('.\n')
      )
    }
    const model = document.parseResult.value as Model
    return executeOOC(model, fileName, interpretPath, globals)
  }

  return {
    interpretPath,
    async interpret(txt: string, fileName = '') {
      // 用真实文件名作为文档 URI，保证 ConfigAwareDocumentValidator 能
      // 按文件目录找到最近的 ooc.json（否则默认 URI 下找不到，默认 off
      // 的规则如 noImplicitAny 会被提前丢弃）。相对路径在 Node 下以
      // 当前工作目录为基准解析。
      const resolved = fileName
        ? resolveEntryFile(fileName, services.LanguageMetaData.fileExtensions)
        : ''
      const document = await parse(txt, {
        documentUri: resolved ? URI.file(resolved).toString() : undefined,
      })
      return execDocument(document, resolved)
    },
  }
}
