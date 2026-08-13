import { AstNode, LangiumDocument, URI } from 'langium'
import { DefaultSharedModuleContext } from 'langium/lsp'
import type { LangiumCoreServices } from 'langium'
import type { Diagnostic } from 'vscode-languageserver-types'
import { DiagnosticSeverity } from 'vscode-languageserver-types'
import { run } from 'wy-helper'
import { ImportStatement, isModel, Model } from '../generated/ast.js'
import { createObjectOrientedCServices } from '../object-oriented-c-module.js'
import {
  extnameOf,
  isAbsolutePath,
  joinPath,
  resolveModuleName,
} from '../module-path.js'
import { interpret, type InterpretAction } from './evaluate.js'
import { type Globals, withGlobals } from './scope.js'
import {
  codeOfDiagnostic,
  dirnameForConfig,
  executeConfigOoc,
  filterDiagnostic,
  findNearestOocConfig,
  uriToPath,
} from '../diagnostics-config.js'

let nextInMemoryId = 0

/**
 * 把字符串源码建成文档并构建（链接），返回可执行/可校验的 LangiumDocument。
 * 不用 langium/test 的 parseHelper：那会拉进 node:assert，浏览器 bundle 里无法加载。
 */
async function parseStringToDocument(
  services: ReturnType<typeof createObjectOrientedCServices>['ObjectOrientedC'],
  txt: string,
  documentUri?: string,
): Promise<LangiumDocument<AstNode>> {
  const extensions = services.LanguageMetaData.fileExtensions
  const uri = URI.parse(
    documentUri ?? `file:///in-memory-${nextInMemoryId++}${extensions[0] ?? ''}`,
  )
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(
    txt,
    uri,
  )
  services.shared.workspace.LangiumDocuments.addDocument(document)
  await services.shared.workspace.DocumentBuilder.build([document], {})
  return document
}

/**
 * Node/CLI 当前工作目录；浏览器没有 process，返回空串（虚拟 FS 按 basename 查找模块）。
 */
function nodeCwd(): string {
  return typeof process !== 'undefined' && typeof process.cwd === 'function'
    ? process.cwd()
    : ''
}

/**
 * 解析入口文件路径：Node 下相对路径以当前工作目录为基准（URI.file 会把相对
 * 路径当成根路径，./demo.ooc 会被解析成 /demo.ooc）；绝对路径与浏览器保持原样。
 * basePath 可选：导入模块时传入当前文档路径作为解析基准。
 */
function resolveEntryFile(
  rawName: string,
  extensions: readonly string[],
  basePath?: string,
): string {
  const cwd = nodeCwd()
  if (typeof basePath === 'string' && basePath) {
    // basePath 已经是目录（来自 dirnameOf(rootPath)）
    // 构造假文件路径，让 resolveModuleName 的 dirnameOf 正确提取目录
    const fromPath = joinPath(basePath, '_')
    return resolveModuleName(rawName, fromPath, extensions)
  }
  // 顶层入口：basePath 非字符串（undefined / Commander Command 对象等）
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

/**
 * 语法级错误（词法 / 解析失败）转成可读信息；类型错误不在此列，
 * 类型检查与运行是两个独立分支，解释器一律不因类型诊断而中断。
 */
function syntaxErrorText(document: LangiumDocument): string | undefined {
  const parserErrors = document.parseResult.parserErrors ?? []
  const lexerErrors = document.parseResult.lexerErrors ?? []
  if (parserErrors.length === 0 && lexerErrors.length === 0) {
    return undefined
  }
  const messages = [
    ...parserErrors.map((e) => e.message),
    ...lexerErrors.map((e) => e.message),
  ]
  return 'Syntax errors:\n' + messages.join('\n')
}

const cacheInterpret = new Map<string, Promise<any>>()
export function createInterpretAction(
  context: DefaultSharedModuleContext,
  globals: Globals = {},
) {
  const services = createObjectOrientedCServices(context).ObjectOrientedC
  const fs = context.fileSystemProvider(services.shared)
  function interpretPath(rawName: string, basePath?: string) {
    const extensions = services.LanguageMetaData.fileExtensions
    // 先解析出实际文件路径，用解析后的路径作为缓存键，避免不同目录下
    // 相同相对路径（如 './foo'）的缓存冲突
    const fileName = resolveEntryFile(rawName, extensions, basePath)
    let value = cacheInterpret.get(fileName)
    if (!value) {
      value = run(async () => {
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
      cacheInterpret.set(fileName, value)
    }
    return value
  }

  async function execDocument(
    document: LangiumDocument<AstNode>,
    fileName: string,
  ) {
    const syntax = syntaxErrorText(document)
    if (syntax) {
      throw syntax
    }
    const model = document.parseResult.value as Model
    return executeOOC(model, fileName, interpretPath, globals)
  }

  return {
    interpretPath,
    async interpret(txt: string, fileName = '') {
      // 用真实文件名作为文档 URI，让 #import 等按文件目录解析相对路径
      const resolved = fileName
        ? resolveEntryFile(fileName, services.LanguageMetaData.fileExtensions)
        : ''
      const document = await parseStringToDocument(
        services,
        txt,
        resolved ? URI.file(resolved).toString() : undefined,
      )
      return execDocument(document, resolved)
    },
  }
}

/**
 * 静态类型检查（独立于解释器）：解析 + 校验，返回按最近 config.ooc / ooc.json 过滤后的
 * 全部诊断（error / warning），不执行代码。与 IDE 里的 LSP 校验走同一套
 * Langium 校验器（ConfigAwareDocumentValidator 按配置升降级）。
 */
export function createTypeCheckAction(context: DefaultSharedModuleContext) {
  const services = createObjectOrientedCServices(context).ObjectOrientedC
  const fs = context.fileSystemProvider(services.shared)
  const docs = services.shared.workspace.LangiumDocuments

  // 创建配置执行器，用解释器执行 config.ooc（复用现有服务）
  const configExecutor = createConfigExecutor(services)

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
    const extensions = services.LanguageMetaData.fileExtensions
    for (const stmt of model.expressions) {
      if (stmt.$type !== 'ImportStatement' && stmt.$type !== 'ImportList') {
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

  async function checkDocument(
    document: LangiumDocument<AstNode>,
    fileName: string,
  ): Promise<Diagnostic[]> {
    await preloadImportTree(document)
    await services.shared.workspace.DocumentBuilder.build([document], {
      validation: true,
    })
    const rawDiagnostics = document.diagnostics ?? []

    // 使用配置过滤诊断（用解释器执行 config.ooc）
    const docPath = uriToPath(document.uri)
    const config = await findNearestOocConfig(
      fs,
      docPath.startsWith('/') ? dirnameForConfig(docPath) : dirnameForConfig('/' + docPath),
      configExecutor,
    )
    return rawDiagnostics.flatMap((d) => {
      const next = filterDiagnostic(config, d.severity, codeOfDiagnostic(d))
      if (next === undefined) {
        return []
      }
      return [{ ...d, severity: next as DiagnosticSeverity }]
    })
  }

  function checkPath(rawName: string): Promise<Diagnostic[]> {
    return run(async () => {
      const extensions = services.LanguageMetaData.fileExtensions
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
      return checkDocument(document, fileName)
    })
  }

  return {
    checkPath,
    async check(txt: string, fileName = '') {
      const resolved = fileName
        ? resolveEntryFile(fileName, services.LanguageMetaData.fileExtensions)
        : ''
      const document = await parseStringToDocument(
        services,
        txt,
        resolved ? URI.file(resolved).toString() : undefined,
      )
      return checkDocument(document, resolved)
    },
  }
}

/**
 * 创建配置文件执行器：用解释器执行 config.ooc，返回最后一条表达式的值。
 * 复用传入的 Langium 服务，不再创建新的服务树。
 */
export function createConfigExecutor(
  services: LangiumCoreServices,
): import('../diagnostics-config.js').ConfigExecutor {
  return async (text: string, fileName: string): Promise<unknown> => {
    return executeConfigOoc(text, fileName, services)
  }
}
