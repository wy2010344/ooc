import { AstNode } from 'langium'
import { DefaultDefinitionProvider } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isRef,
} from './generated/ast.js'
import { LocationLink } from 'vscode-languageserver'

/**
 * OOC 跳转定义提供者
 * 支持跳转到变量定义
 */
export class ObjectOrientedCDefinitionProvider extends DefaultDefinitionProvider {

  constructor(services: ObjectOrientedCServices) {
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

    return links
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
    const targetCstNode = targetNode.$cstNode
    if (!targetCstNode) return undefined

    const targetRange = targetCstNode.range
    if (!targetRange) return undefined

    const sourceRange = sourceCstNode.range

    // 获取文档 URI：通过 AST 节点的 $document 属性
    // 只有根节点有 $document，所以需要向上遍历
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