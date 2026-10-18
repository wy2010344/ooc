import {
  AstNode,
  AstUtils,
  CstNode,
  isCompositeCstNode,
  isLeafCstNode,
  URI,
} from 'langium'
import { DefaultDefinitionProvider } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isImportStatement,
  isMethodAll,
  isRef,
} from './generated/ast.js'
import { LocationLink, Range } from 'vscode-languageserver'
import {
  PACKAGE_URI_PREFIX,
  dirnameOf,
  joinPath,
  resolveModuleName,
} from './module-path.js'

/** 目标文件起始位置（跳到文件头即可，不定位到具体符号）。 */
const FILE_START_RANGE: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
}

/**
 * OOC 跳转定义提供�?
 * 支持跳转到变量定义，以及 #import 路径跳到目标模块文件�?
 */
export class ObjectOrientedCDefinitionProvider extends DefaultDefinitionProvider {

  constructor(private readonly services: ObjectOrientedCServices) {
    super(services)
  }

  /**
   * 为变量引用提供定义位置
   */
  protected override collectLocationLinks(
    sourceCstNode: any,
    _params: any,
  ): LocationLink[] | undefined {
    const baseResult = super.collectLocationLinks(sourceCstNode, _params)
    const links: LocationLink[] = Array.isArray(baseResult) ? [...baseResult] : []

    // 尝试从 Ref 节点查找变量定义
    const sourceNode = sourceCstNode.astNode
    if (sourceNode && isRef(sourceNode)) {
      const varName = sourceNode.value
      const definitionNode = this.findDefinition(sourceNode, varName)
      if (definitionNode) {
        const link = this.createLocationLink(sourceCstNode, definitionNode)
        if (link) {
          links.push(link)
        }
      }
    }

    // #import 路径 → 跳到目标模块文件
    const importLink = this.collectImportLink(sourceCstNode)
    if (importLink) {
      links.push(importLink)
    }

    return links
  }

  /**
   * 光标落在 #import 的路径字符串上时，解析出目标文件并返回跳转链接。
   * 相对路径按导入文件所在目录解析；@pkg 包引用从导入文件所在目录向上找
   * .ooc_modules/<pkg>（与 CLI ooc install 的落盘位置一致）。
   */
  private collectImportLink(sourceCstNode: any): LocationLink | undefined {
    if (!isLeafCstNode(sourceCstNode)) return undefined
    const statement = sourceCstNode.astNode
    if (!statement || !isImportStatement(statement)) return undefined
    // 路径 token 是语句里唯一的字符串字面量（去掉首尾引号后等于 statement.path）
    const rawText: string = sourceCstNode.text
    if (rawText.length < 2) return undefined
    const quote = rawText[0]
    if ((quote !== "'" && quote !== '"') || rawText[rawText.length - 1] !== quote) {
      return undefined
    }
    if (rawText.slice(1, -1) !== statement.path) return undefined

    const doc = AstUtils.getDocument(statement)
    const extensions = this.services.LanguageMetaData.fileExtensions
    const resolved = resolveModuleName(statement.path, doc.uri.path, extensions)
    const targetUri = this.resolveImportUri(resolved, doc.uri.path)
    if (!targetUri) return undefined

    return {
      originSelectionRange: sourceCstNode.range,
      targetUri: targetUri.toString(),
      targetRange: FILE_START_RANGE,
      targetSelectionRange: FILE_START_RANGE,
    }
  }

  /** 把解析出的模块路径转成真实文件 URI；找不到返回 undefined。 */
  private resolveImportUri(resolved: string, fromPath: string): URI | undefined {
    const documents = this.services.shared.workspace.LangiumDocuments
    const fs = this.services.shared.workspace.FileSystemProvider
    const known = (uri: URI) => !!documents.getDocument(uri) || fs.existsSync(uri)

    if (resolved.startsWith(PACKAGE_URI_PREFIX + '/')) {
      const rest = resolved.slice(PACKAGE_URI_PREFIX.length + 1)
      let dir = dirnameOf(fromPath)
      while (dir) {
        const candidate = URI.file(joinPath(dir, `.ooc_modules/${rest}`))
        if (known(candidate)) return candidate
        const parent = dirnameOf(dir)
        if (parent === dir) break
        dir = parent
      }
      return undefined
    }
    const uri = URI.file(resolved)
    return known(uri) ? uri : undefined
  }

  /**
   * 在 AST 中查找变量定义
   */
  private findDefinition(
    node: AstNode,
    name: string,
  ): AstNode | undefined {
    let current: AstNode | undefined = node.$container
    while (current) {
      const found = this.searchInScope(current, name)
      if (found) return found
      current = current.$container
    }
    return undefined
  }

  /**
   * 在节点的子树中搜索变量定义
   */
  private searchInScope(node: AstNode, name: string): AstNode | undefined {
    // 方法体（含实现方法）里的赋值定义；body 抽到 MethodBody 后字段在 body 上
    if (isMethodAll(node) && node.body) {
      for (const expr of node.body.stmts) {
        if (isAssignment(expr) && expr.name === name) {
          return expr
        }
      }
    }
    if ('expressions' in node && Array.isArray((node as any).expressions)) {
      for (const expr of (node as any).expressions) {
        if (isAssignment(expr) && expr.name === name) {
          return expr
        }
      }
    }
    return undefined
  }

  /**
   * 创建位置链接
   */
  private createLocationLink(
    sourceCstNode: any,
    targetNode: AstNode,
  ): LocationLink | undefined {
    // 尝试找到变量名本身的 CST 节点
    const nameCstNode = this.findNameCstNode(targetNode)
    let targetCstNode = nameCstNode
    if (!targetCstNode) {
      // 如果找不到变量名的 CST 节点，则使用目标节点本身
      targetCstNode = targetNode.$cstNode
    }
    if (!targetCstNode) return undefined

    let targetRange = targetCstNode.range
    if (!targetRange) return undefined

    // 如果目标范围太大（大于变量名本身），尝试缩小范围
    // 对于 Assignment 节点，只使用变量名的位置
    if (isAssignment(targetNode) && targetRange.end.character - targetRange.start.character > 1) {
      const nameCst = this.findNameCstNode(targetNode)
      if (nameCst?.range) {
        targetRange = nameCst.range
      }
    }

    const sourceRange = sourceCstNode.range

    // 获取文档 URI：通过 AST 节点的 $document 属性
    const documentUri = this.getDocumentUri(targetNode)
    if (!documentUri) return undefined

    return {
      originSelectionRange: sourceRange ? {
        start: {
          line: sourceRange.start.line,
          character: sourceRange.start.character,
        },
        end: {
          line: sourceRange.end.line,
          character: sourceRange.end.character,
        },
      } : undefined,
      targetUri: documentUri,
      targetRange: {
        start: {
          line: targetRange.start.line,
          character: targetRange.start.character,
        },
        end: {
          line: targetRange.end.line,
          character: targetRange.end.character,
        },
      },
      targetSelectionRange: {
        start: {
          line: targetRange.start.line,
          character: targetRange.start.character,
        },
        end: {
          line: targetRange.end.line,
          character: targetRange.end.character,
        },
      },
    }
  }

  /**
   * 查找变量名的 CST 叶节点
   *
   * Langium 的 CST 是嵌套结构：Assignment 的 $cstNode 是一个复合节点，
   * 其子节点可能仍是复合节点（如嵌套的 Assignment 层），
   * 最终才到叶节点（x、=、42 等）。
   * 必须递归查找叶节点，而不仅仅是直接子节点。
   */
  private findNameCstNode(node: AstNode): CstNode | undefined {
    if (!isAssignment(node) || !node.name) return undefined
    const cstNode = node.$cstNode
    if (!cstNode) return undefined
    return this.findLeafWithText(cstNode, node.name)
  }

  /**
   * 递归在 CST 树中查找文本匹配的叶节点
   */
  private findLeafWithText(cstNode: CstNode, text: string): CstNode | undefined {
    if (isLeafCstNode(cstNode)) {
      return cstNode.text === text ? cstNode : undefined
    }
    if (isCompositeCstNode(cstNode)) {
      for (const child of cstNode.content) {
        const found = this.findLeafWithText(child, text)
        if (found) return found
      }
    }
    return undefined
  }

  /**
   * 获取 AST 节点所在文档的 URI
   */
  private getDocumentUri(node: AstNode): string | undefined {
    // 向上遍历找到根节点（根节点有 $document 属性）
    let current: AstNode | undefined = node
    while (current) {
      if (current.$document) {
        return current.$document.uri.toString()
      }
      current = current.$container
    }
    return undefined
  }
}