import { AstNode, LangiumDocument, URI } from 'langium'
import { DefaultSharedModuleContext } from 'langium/lsp'
import type { Diagnostic } from 'vscode-languageserver-types'
import { run } from 'wy-helper'
import { ImportStatement, isModel, Model } from '../generated/ast.js'
import { createObjectOrientedCServices } from '../object-oriented-c-module.js'
import {
  extnameOf,
  joinPath,
  resolveModuleName,
  toPosix,
} from '../module-path.js'
import { interpret, type InterpretAction } from './evaluate.js'
import { type Globals, withGlobals } from './scope.js'

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
 * 静态类型检查（独立于解释器）：解析 + 校验，返回按最近 ooc.json 过滤后的
 * 全部诊断（error / warning），不执行代码。与 IDE 里的 LSP 校验走同一套
 * Langium 校验器（ConfigAwareDocumentValidator 按 ooc.json 升降级）。
 */
export function createTypeCheckAction(context: DefaultSharedModuleContext) {
  const services = createObjectOrientedCServices(context).ObjectOrientedC
  const fs = context.fileSystemProvider(services.shared)
  const docs = services.shared.workspace.LangiumDocuments

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
    return document.diagnostics ?? []
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
