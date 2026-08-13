import { Location } from 'vscode-languageserver'
import type { AstNode, LangiumDocument } from 'langium'
import {
  isAssignment,
  isMessage,
  isMethodAll,
  isParam,
  isRef,
  type Message,
  type MethodAll,
  type Ref,
} from './generated/ast.js'

/**
 * OOC 查找引用提供者
 *
 * OOC 语言不使用 Langium 标准的交叉引用语法（[TypeName]），
 * 引用解析通过自定义实现。此 Provider 基于名称匹配来查找所有引用位置。
 */
export class ObjectOrientedCReferencesProvider {

  /**
   * 查找所有引用指定节点的位置
   */
  findReferences(
    document: LangiumDocument,
    params: { position: { line: number; character: number }; context: { includeDeclaration: boolean } },
    _cancelToken?: any,
  ): Location[] {
    const rootNode = document.parseResult?.value
    if (!rootNode) return []

    // 使用 Langium 的 findDeclarationNodeAtOffset 找到光标位置的节点
    const offset = document.textDocument.offsetAt(params.position)
    const targetNode = this.findNodeAtOffset(rootNode, offset)
    if (!targetNode) return []

    const name = this.getNodeName(targetNode)
    if (!name) return []

    const locations: Location[] = []
    const uri = document.uri?.toString()

    if (!uri) return []

    // 如果需要包含声明本身
    if (params.context.includeDeclaration) {
      const loc = this.nodeToLocation(targetNode, uri)
      if (loc) locations.push(loc)
    }

    // 遍历文档查找所有引用
    this.collectReferences(rootNode, name, locations, uri)

    return locations
  }

  /**
   * 在文档中查找指定偏移量处的节点
   */
  private findNodeAtOffset(root: AstNode, offset: number): AstNode | undefined {
    const cstNode = (root as any).$cstNode
    if (!cstNode) return undefined

    // 遍历 CST 查找指定偏移处的节点
    return this.traverseCstForOffset(cstNode, offset)?.astNode
  }

  /**
   * 遍历 CST 查找指定偏移处的节点
   */
  private traverseCstForOffset(cstNode: any, offset: number): any | undefined {
    if (!cstNode || offset < cstNode.offset || offset > cstNode.offset + cstNode.length) {
      return undefined
    }

    // 如果有子节点，尝试在子节点中查找
    if (cstNode.children && cstNode.children.length > 0) {
      for (const child of cstNode.children) {
        const found = this.traverseCstForOffset(child, offset)
        if (found) return found
      }
    }

    // 叶子节点就是目标
    return cstNode
  }

  /**
   * 获取节点的名称
   */
  private getNodeName(node: AstNode): string | undefined {
    if (isAssignment(node)) {
      return node.name
    }
    if (isMethodAll(node)) {
      return this.getMethodName(node)
    }
    if (isParam(node as any)) {
      return (node as any).name
    }
    if (isRef(node)) {
      return node.value
    }
    // 对于 Message 的 name
    if (isMessage(node)) {
      return this.getMethodCallName(node)
    }
    // 向上查找父节点的名称
    return this.findParentName(node)
  }

  /**
   * 向上查找父节点的名称
   */
  private findParentName(node: AstNode): string | undefined {
    let current = node.$container
    while (current) {
      if (isAssignment(current)) return current.name
      if (isMethodAll(current)) return this.getMethodName(current)
      if (isParam(current as any)) return (current as any).name
      if (isRef(current)) return current.value
      if (isMessage(current)) return this.getMethodCallName(current)
      current = current.$container
    }
    return undefined
  }

  /**
   * 获取方法名（从 MethodAll 的 name 字段）
   */
  private getMethodName(method: MethodAll): string | undefined {
    const nameNode = method.name
    if (!nameNode) return undefined
    return this.extractNameValue(nameNode)
  }

  /**
   * 获取消息调用名
   */
  private getMethodCallName(message: Message): string {
    const nameNode = message.name
    if (!nameNode) return ''
    return this.extractNameValue(nameNode) ?? ''
  }

  /**
   * 从 Name 节点提取字符串值
   */
  private extractNameValue(nameNode: any): string | undefined {
    if (!nameNode) return undefined
    if (typeof nameNode === 'string') return nameNode
    // MethodDefName / MethodCallName: { value: Ref | StID | Str }
    if (nameNode.value) {
      if (typeof nameNode.value === 'string') return nameNode.value
      if (typeof nameNode.value === 'object' && 'value' in nameNode.value) {
        return (nameNode.value as any).value as string
      }
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
    uri: string,
  ): void {
    // 如果是 Ref 节点，检查是否匹配目标名称
    if (isRef(node as any) && (node as Ref).value === name) {
      const loc = this.nodeToLocation(node, uri)
      if (loc) locations.push(loc)
    }

    // 如果是 Message，检查消息名是否匹配
    if (isMessage(node)) {
      const msgName = this.getMethodCallName(node)
      if (msgName === name) {
        const loc = this.nodeToLocation(node, uri)
        if (loc) locations.push(loc)
      }
    }

    // 如果是 Assignment，检查变量名是否匹配
    if (isAssignment(node) && node.name === name) {
      const loc = this.nodeToLocation(node, uri)
      if (loc) locations.push(loc)
    }

    // 遍历所有子节点
    this.traverseAllChildren(node, name, locations, uri)
  }

  /**
   * 遍历所有子节点（使用 Langium 的 reflection API）
   */
  private traverseAllChildren(
    node: AstNode,
    name: string,
    locations: Location[],
    uri: string,
  ): void {
    // 使用 $cstNode 的 children 遍历
    const cstNode = (node as any).$cstNode
    if (cstNode?.children) {
      for (const child of cstNode.children) {
        if (child?.astNode) {
          this.collectReferences(child.astNode, name, locations, uri)
        }
      }
    }
  }

  /**
   * 将节点转换为 Location
   */
  private nodeToLocation(node: AstNode, uri: string): Location | undefined {
    const cstNode = (node as any).$cstNode
    if (!cstNode) return undefined

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
