import { Location, ReferenceParams } from 'vscode-languageserver'
import { CstUtils, isCompositeCstNode, isLeafCstNode } from 'langium'
import { DefaultReferencesProvider } from 'langium/lsp'
import type { AstNode, CstNode, LangiumDocument } from 'langium'
import type { LangiumServices } from 'langium/lsp'
import {
  isAssignment,
  isMessage,
  isParam,
  isRef,
  isMethodAll,
  isMethodBind,
  isMethodBindMutable,
  type MethodAll,
  type MethodBind,
  type MethodBindMutable,
  type Message,
} from './generated/ast.js'

/**
 * OOC 查找引用提供者
 *
 * OOC 不使用 Langium 标准交叉引用语法，引用解析通过名称匹配实现。
 * 继承 DefaultReferencesProvider，覆盖 findReferences 以实现基于名称的查找。
 */
export class ObjectOrientedCReferencesProvider extends DefaultReferencesProvider {

  private _seenRanges: Set<string> = new Set()

  constructor(services: LangiumServices) {
    super(services)
  }

  /**
   * 查找所有引用指定节点的位置
   */
  override findReferences(
    document: LangiumDocument,
    params: ReferenceParams,
    _cancelToken?: any,
  ): Location[] {
    const rootNode = document.parseResult?.value?.$cstNode
    if (!rootNode) return []

    const offset = document.textDocument.offsetAt(params.position)
    const cstNode = CstUtils.findDeclarationNodeAtOffset(rootNode, offset, this.grammarConfig.nameRegexp)
    if (!cstNode) return []

    const targetNode = cstNode.astNode
    if (!targetNode) return []

    const name = this.getNodeName(targetNode)
    if (!name) return []

    const allLocations: Array<{ location: Location; isDeclaration: boolean; rangeKey: string }> = []
    const uri = document.uri?.toString()
    if (!uri) return []

    this._seenRanges.clear()
    this.collectReferencesWithMeta(rootNode, name, allLocations, uri)

    // 确定光标的语义节点的 rangeKey，用于排除自身位置
    const cursorRange = cstNode.range
    const cursorKey = cursorRange
      ? `${cursorRange.start.line}:${cursorRange.start.character}-${cursorRange.end.line}:${cursorRange.end.character}`
      : ''

    if (params.context.includeDeclaration) {
      // includeDeclaration=true: 保留所有匹配（声明 + 使用），但排除光标自身位置
      return allLocations
        .filter((item) => item.rangeKey !== cursorKey)
        .map((item) => item.location)
    } else {
      // includeDeclaration=false: 只保留使用处（排除声明和光标自身）
      return allLocations
        .filter((item) => !item.isDeclaration && item.rangeKey !== cursorKey)
        .map((item) => item.location)
    }
  }

  /**
   * 获取节点的名称
   */
  private getNodeName(node: AstNode): string | undefined {
    if (isAssignment(node)) return node.name
    if (isParam(node)) return node.name
    if (isRef(node)) return node.value
    if (isMethodAll(node)) return this.getMethodName(node)
    if (isMethodBind(node)) return this.getBindName(node)
    if (isMethodBindMutable(node)) return this.getMutableName(node)
    if (isMessage(node)) return this.getMethodCallName(node)
    return this.findParentName(node)
  }

  /**
   * 向上查找父节点名称
   */
  private findParentName(node: AstNode): string | undefined {
    let current = node.$container
    while (current) {
      if (isAssignment(current)) return current.name
      if (isParam(current)) return current.name
      if (isMethodAll(current)) return this.getMethodName(current)
      if (isMethodBind(current)) return this.getBindName(current)
      if (isMethodBindMutable(current)) return this.getMutableName(current)
      if (isMessage(current)) return this.getMethodCallName(current)
      current = current.$container
    }
    return undefined
  }

  private getMethodName(method: MethodAll): string | undefined {
    return this.extractNameFromDefName(method.name)
  }

  private getBindName(bind: MethodBind): string | undefined {
    return this.extractNameFromDefName(bind.name)
  }

  private getMutableName(mutable: MethodBindMutable): string | undefined {
    return this.extractNameFromDefName(mutable.name)
  }

  /**
   * 从 MethodDefName / MethodCallName 提取字符串值
   */
  private extractNameFromDefName(nameNode: any): string | undefined {
    if (!nameNode) return undefined
    const innerName = nameNode.name
    if (!innerName) return undefined
    if (isRef(innerName)) return innerName.value
    if (innerName.$type === 'StID') return innerName.value.replace(/^"/, '').replace(/"$/, '')
    if (innerName.$type === 'Str') return innerName.value.replace(/^'/, '').replace(/'$/, '')
    return undefined
  }

  private getMethodCallName(message: Message): string | undefined {
    const nameNode = message.name
    if (!nameNode) return undefined
    const value = nameNode.value
    if (!value) return undefined
    if (isRef(value)) return value.value
    if (value.$type === 'StID') return value.value.replace(/^"/, '').replace(/"$/, '')
    if (value.$type === 'Str') return value.value.replace(/^'/, '').replace(/'$/, '')
    return undefined
  }

  /**
   * 收集所有引用指定名称的节点（带 isDeclaration 元数据）
   */
  private collectReferencesWithMeta(
    cstNode: CstNode,
    name: string,
    results: Array<{ location: Location; isDeclaration: boolean; rangeKey: string }>,
    uri: string,
  ): void {
    if (isLeafCstNode(cstNode)) {
      const astNode = cstNode.astNode
      if (!astNode) return

      const semanticNode = this.resolveSemanticNode(cstNode)
      if (!semanticNode) return

      const leafText = cstNode.text

      // 精确匹配：语义节点类型 + 文本
      let matched = false
      let isDecl = false

      if (isRef(semanticNode) && semanticNode.value === name && leafText === name) {
        matched = true
        isDecl = false
      } else if (isAssignment(semanticNode) && semanticNode.name === name && leafText === name) {
        matched = true
        isDecl = true
      } else if (isParam(semanticNode) && semanticNode.name === name && leafText === name) {
        matched = true
        isDecl = true
      } else if (isMethodAll(semanticNode)) {
        const methodName = this.getMethodName(semanticNode)
        if (methodName === name && leafText === name) {
          matched = true
          isDecl = true
        }
      } else if (isMethodBind(semanticNode)) {
        const bindName = this.getBindName(semanticNode)
        if (bindName === name && leafText === name) {
          matched = true
          isDecl = true
        }
      } else if (isMethodBindMutable(semanticNode)) {
        const mutableName = this.getMutableName(semanticNode)
        if (mutableName === name && leafText === name) {
          matched = true
          isDecl = true
        }
      } else if (isMessage(semanticNode)) {
        const msgName = this.getMethodCallName(semanticNode)
        if (msgName === name && leafText === name) {
          matched = true
          isDecl = false
        }
      }

      if (matched) {
        const loc = this.cstNodeToLocation(cstNode, uri)
        if (loc) {
          const rangeKey = `${loc.range.start.line}:${loc.range.start.character}-${loc.range.end.line}:${loc.range.end.character}`
          if (!this._seenRanges.has(rangeKey)) {
            this._seenRanges.add(rangeKey)
            results.push({ location: loc, isDeclaration: isDecl, rangeKey })
          }
        }
      }
      return
    }

    if (isCompositeCstNode(cstNode)) {
      for (const child of cstNode.content) {
        this.collectReferencesWithMeta(child, name, results, uri)
      }
    }
  }

  /**
   * 解析叶节点语义上所属的声明节点
   *
   * Langium 中，CST 叶节点的 astNode 指向最近的复合节点 AST。
   * 对于简单场景（Ref、Assignment、Param），叶节点就是语义节点本身的 CST。
   * 对于嵌套场景（MethodAll、MethodBind、MethodBindMutable、Message），
   * 叶节点的 astNode 可能指向外层复合，需要沿 CST 树向上查找真正的语义节点。
   */
  private resolveSemanticNode(leaf: CstNode): AstNode | undefined {
    const directAst = leaf.astNode
    if (!directAst) return undefined

    // 直接类型匹配（Ref、Assignment、Param 等，叶节点的 astNode 就是语义节点）
    if (isRef(directAst) || isAssignment(directAst) || isParam(directAst)) {
      return directAst
    }

    // 对于 MethodAll/MethodBind/MethodBindMutable/Message 等，
    // 叶节点可能被嵌套的复合节点共享，需要向上查找真正的语义节点
    let current: CstNode | undefined = leaf
    while (current?.container) {
      const parent: CstNode = current.container
      const parentAst = parent.astNode
      if (parentAst && (isMethodAll(parentAst) || isMethodBind(parentAst) || isMethodBindMutable(parentAst) || isMessage(parentAst))) {
        return parentAst
      }
      current = parent
    }

    // 回退：直接返回 astNode
    return directAst
  }

  /**
   * 将 CST 节点转换为 Location
   */
  private cstNodeToLocation(cstNode: CstNode, uri: string): Location | undefined {
    const range = cstNode.range
    if (!range) return undefined

    return Location.create(uri, {
      start: {
        line: range.start.line,
        character: range.start.character,
      },
      end: {
        line: range.end.line,
        character: range.end.character,
      },
    })
  }
}
