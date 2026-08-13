import { Location } from 'vscode-languageserver'
import type { AstNode } from 'langium'
import {
  isAssignment,
  isMethod,
  isParam,
  isRef,
  isMessage,
  type Method,
} from './generated/ast.js'

/**
 * OOC 查找引用提供者
 *
 * 由于 OOC 语言不使用 Langium 标准的交叉引用语法（[TypeName]），
 * 引用解析是通过自定义的类型检查器实现的。因此我们需要自定义
 * ReferencesProvider 来遍历 AST 查找所有引用位置。
 */
export class ObjectOrientedCReferencesProvider {

  /**
   * 查找所有引用指定节点的位置
   */
  findReferences(
    document: any,
    params: { position: { line: number; character: number }; context: { includeDeclaration: boolean } },
    _cancelToken?: any,
  ): Location[] {
    const rootNode = document.parseResult?.value
    if (!rootNode) return []

    const offset = document.textDocument.offsetAt(params.position)
    const targetNode = this.findNodeAtOffset(rootNode, offset)
    if (!targetNode) return []

    const name = this.getNodeName(targetNode)
    if (!name) return []

    const locations: Location[] = []

    // 如果需要包含声明本身
    if (params.context.includeDeclaration) {
      const loc = this.nodeToLocation(targetNode, document)
      if (loc) locations.push(loc)
    }

    // 遍历文档查找所有引用
    this.collectReferences(rootNode, name, locations, document)

    return locations
  }

  /**
   * 在文档中查找指定偏移量处的节点
   */
  private findNodeAtOffset(root: AstNode, offset: number): AstNode | undefined {
    const cstNode = (root as any).$cstNode
    if (!cstNode) return undefined

    // 找到该位置的叶子节点
    let current: any = cstNode
    while (current && current.children && current.children.length > 0) {
      let child: any = undefined
      for (const c of current.children) {
        if (c.offset <= offset && offset <= c.offset + c.length) {
          child = c
          break
        }
      }
      if (!child) break
      current = child
    }

    return current?.astNode
  }

  /**
   * 获取节点的名称
   */
  private getNodeName(node: AstNode): string | undefined {
    if (isAssignment(node)) {
      return node.name
    }
    if (isMethod(node)) {
      return this.getMethodName(node)
    }
    if (isParam(node)) {
      return node.name
    }
    // 对于 Ref 节点，获取其引用的名称
    if (isRef(node)) {
      return node.value
    }
    return undefined
  }

  /**
   * 获取方法名
   */
  private getMethodName(method: Method): string | undefined {
    const nameNode = method.name
    if (!nameNode) return undefined

    // MethodDefName: name=(Ref|Str|StID)
    if (typeof nameNode === 'object' && 'value' in nameNode) {
      const value = (nameNode as any).value
      if (typeof value === 'object' && value !== null && 'value' in value) {
        return (value as any).value as string
      }
      return value as string
    }
    return undefined
  }

  /**
   * 收集所有引用指定名称的节点
   */
  private collectReferences(
    node: AstNode,
    name: string,
    locations: Location[],
    document: any,
  ): void {
    // 如果是 Ref 节点，检查是否引用目标名称
    if (isRef(node) && node.value === name) {
      const loc = this.nodeToLocation(node, document)
      if (loc) locations.push(loc)
    }

    // 如果是 Message 节点，检查消息名是否匹配
    if (isMessage(node)) {
      const msgName = this.getMessageName(node)
      if (msgName === name) {
        const loc = this.nodeToLocation(node, document)
        if (loc) locations.push(loc)
      }
    }

    // 递归遍历子节点（使用 $container 链或 $cstNode 子节点）
    this.traverseChildren(node, name, locations, document)
  }

  /**
   * 遍历子节点
   */
  private traverseChildren(
    node: AstNode,
    name: string,
    locations: Location[],
    document: any,
  ): void {
    // 尝试使用 $cstNode 的 children
    const cstNode = (node as any).$cstNode
    if (cstNode?.children) {
      for (const child of cstNode.children) {
        if (child?.astNode) {
          this.collectReferences(child.astNode, name, locations, document)
        }
      }
    }
  }

  /**
   * 获取消息名
   */
  private getMessageName(message: any): string {
    const nameNode = message.name
    if (!nameNode) return ''
    if (typeof nameNode === 'object' && 'value' in nameNode) {
      const value = (nameNode as any).value
      if (typeof value === 'object' && value !== null && 'value' in value) {
        return (value as any).value as string
      }
      return value as string
    }
    return ''
  }

  /**
   * 将节点转换为 Location
   */
  private nodeToLocation(node: AstNode, document: any): Location | undefined {
    const cstNode = (node as any).$cstNode
    if (!cstNode) return undefined

    const range = cstNode.range
    if (!range) return undefined

    const uri = document.uri?.toString() ?? document.textDocument?.uri
    if (!uri) return undefined

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
