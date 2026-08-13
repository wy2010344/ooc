import { Hover, HoverParams } from 'vscode-languageserver'
import { CstUtils } from 'langium'
import { AstNodeHoverProvider } from 'langium/lsp'
import type { AstNode, CstNode, LangiumDocument } from 'langium'
import type { LangiumServices } from 'langium/lsp'
import {
  isAssignment,
  isBool,
  isExpression,
  isImportStatement,
  isLambdaDef,
  isMessage,
  isMessageOrChain,
  isMethodAll,
  isMethodBind,
  isMethodBindMutable,
  isNil,
  isNum,
  isPrimary,
  isRef,
  isStr,
  isStID,
  isParam,
  type LambdaDef,
  type Message,
  type MethodAll,
  type MethodBind,
  type MethodBindMutable,
  type MethodCallName,
} from './generated/ast.js'
import { getSharedChecker } from './shared-checker.js'
import {
  describeType,
  getBuiltinMethods,
  typeToString,
  type TypeInfo,
} from './type-system.js'

/**
 * OOC Hover 提供者
 * 继承 AstNodeHoverProvider，覆盖引用解析以支持 OOC 基于名称的引用
 */
export class ObjectOrientedCHoverProvider extends AstNodeHoverProvider {
  private readonly checker: ReturnType<typeof getSharedChecker>

  constructor(services: LangiumServices) {
    super(services)
    this.checker = getSharedChecker(services)
  }

  /**
   * 覆盖 getHoverContent 以支持 OOC 特有的引用解析
   * 完全掌控 Hover 逻辑，不依赖基类的 findDeclarations
   */
  override async getHoverContent(
    document: LangiumDocument,
    params: HoverParams,
  ): Promise<Hover | undefined> {
    const cstRoot = document.parseResult?.value?.$cstNode
    if (!cstRoot) return undefined

    const offset = document.textDocument.offsetAt(params.position)
    // 先尝试使用 findDeclarationNodeAtOffset（会调整 offset 以匹配标识符）
    let cstNode = CstUtils.findDeclarationNodeAtOffset(cstRoot, offset, this.grammarConfig.nameRegexp)
    // 如果找不到节点，或者找到的节点的 offset 与原始 offset 差距太大（说明被调整过），
    // 则尝试使用原始 offset 直接查找
    if (!cstNode || Math.abs(cstNode.offset - offset) > 1) {
      cstNode = CstUtils.findLeafNodeAtOffset(cstRoot, offset)
    }
    if (!cstNode) return undefined

    const astNode = cstNode.astNode
    if (!astNode) return undefined

    // 如果是 Ref 节点，自定义解析到声明
    if (isRef(astNode)) {
      const resolvedNode = this.resolveDeclaration(astNode)
      const content = await this.getAstNodeHoverContent(resolvedNode ?? astNode)
      if (typeof content === 'string' && content.length > 0) {
        return {
          contents: {
            kind: 'markdown',
            value: content,
          },
        }
      }
      return undefined
    }

    // 对于非 Ref 节点，直接使用我们自己的 getAstNodeHoverContent
    const content = await this.getAstNodeHoverContent(astNode)
    if (typeof content === 'string' && content.length > 0) {
      return {
        contents: {
          kind: 'markdown',
          value: content,
        },
      }
    }
    return undefined
  }

  /**
   * 获取 AST 节点的悬停内容
   * 覆盖基类方法，为 OOC 各种节点类型提供自定义悬停信息
   */
  protected override getAstNodeHoverContent(node: AstNode): MaybePromise<string | undefined> {
    const cstNode = (node as any).$cstNode
    const comment = cstNode ? this.getNodeComment(cstNode) : ''
    return this.getAstNodeHoverContentImpl(node, comment)
  }

  /**
   * 解析 Ref 引用到其声明节点
   */
  private resolveDeclaration(node: AstNode): AstNode | undefined {
    if (!isRef(node)) return undefined
    const name = node.value
    if (!name) return undefined

    const visited = new Set<AstNode>()
    let current: AstNode | undefined = node.$container
    while (current) {
      const found = this.findDeclarationInNode(current, name, visited)
      if (found) return found
      current = current.$container
    }

    const root = this.getRootNode(node)
    if (root) {
      return this.findDeclarationInNode(root, name, visited)
    }

    return undefined
  }

  /**
   * 在指定节点中查找指定名称的声明
   */
  private findDeclarationInNode(node: AstNode, name: string, visited: Set<AstNode>): AstNode | undefined {
    if (visited.has(node)) return undefined
    visited.add(node)

    if (isAssignment(node) && node.name === name) return node
    if (isParam(node) && node.name === name) return node
    if (isMethodAll(node)) {
      const methodName = this.getMethodName(node)
      if (methodName === name) return node
    }
    if (isMethodBind(node)) {
      const bindName = this.getBindName(node)
      if (bindName === name) return node
    }
    if (isMethodBindMutable(node)) {
      const mutableName = this.getMutableName(node)
      if (mutableName === name) return node
    }

    const children = this.getAstChildren(node)
    for (const child of children) {
      const found = this.findDeclarationInNode(child, name, visited)
      if (found) return found
    }

    return undefined
  }

  /**
   * 获取 AST 节点的子节点
   */
  private getAstChildren(node: AstNode): AstNode[] {
    const children: AstNode[] = []
    const cstNode = (node as any).$cstNode
    if (cstNode?.content) {
      for (const child of cstNode.content) {
        if (child.astNode) {
          children.push(child.astNode)
        }
      }
    }
    return children
  }

  /**
   * 获取根节点
   */
  private getRootNode(node: AstNode): AstNode | undefined {
    let current: AstNode | undefined = node
    while (current?.$container) {
      current = current.$container
    }
    return current
  }

  /**
   * 获取节点的注释
   */
  private getNodeComment(cstNode: CstNode): string {
    const commentNode = CstUtils.findCommentNode(cstNode, ['ML_COMMENT', 'SL_COMMENT'])
    if (commentNode) {
      const text = commentNode.text
      return text
        .replace(/^\/\/\s*/, '')
        .replace(/^\/\*\s*/, '')
        .replace(/\s*\*\/$/, '')
    }
    return ''
  }

  /**
   * 实际实现：带注释参数的悬停内容生成
   */
  private getAstNodeHoverContentImpl(node: AstNode, comment: string): string | undefined {
    if (isRef(node)) {
      return this.handleRefHover(node, comment)
    }

    if (isAssignment(node)) {
      return this.handleAssignmentHover(node, comment)
    }

    if (isParam(node)) {
      return this.handleParamHover(node, comment)
    }

    if (isImportStatement(node)) {
      return this.buildHoverContent(`导入 ${node.name}`, comment)
    }

    if (isMethodAll(node)) {
      return this.handleMethodAllHover(node, comment)
    }

    if (isMethodBind(node)) {
      const typeAnno = node.typeAnnotation
        ? `: ${this.formatType(node.typeAnnotation)}`
        : ''
      return this.buildHoverContent(
        `绑定 ${this.extractName(node.name)}${typeAnno}`,
        comment,
      )
    }

    if (isMethodBindMutable(node)) {
      const typeAnno = node.typeAnnotation
        ? `: ${this.formatType(node.typeAnnotation)}`
        : ''
      return this.buildHoverContent(
        `可变属性 ${this.extractName(node.name)}${typeAnno}（无参读取，有参修改）`,
        comment,
      )
    }

    if (isLambdaDef(node)) {
      return this.handleLambdaHover(node, comment)
    }

    if (isMessage(node)) {
      return this.handleMessageHover(node, comment)
    }

    if (isMessageOrChain(node)) {
      const t = this.checker.inferType(node)
      return this.buildHoverContent(this.describeHoverType(t), comment)
    }

    if (isNum(node)) {
      return this.buildHoverContent(`数字 ${node.value}：number`, comment)
    }
    if (isStr(node)) {
      return this.buildHoverContent(`字符串 ${node.value}：string`, comment)
    }
    if (isBool(node)) {
      return this.buildHoverContent(`布尔 ${node.value}：bool`, comment)
    }
    if (isNil(node)) {
      return this.buildHoverContent('nil：null', comment)
    }

    if (isStID(node)) {
      return this.buildHoverContent(`标识符 ${node.value}`, comment)
    }

    if (isExpression(node) || isPrimary(node)) {
      const t = this.checker.inferType(node)
      return this.buildHoverContent(this.describeHoverType(t), comment)
    }

    return undefined
  }

  private handleRefHover(node: any, comment: string): string {
    const t = this.checker.inferType(node)
    return this.buildHoverContent(
      `引用 ${node.value}：${this.describeHoverType(t)}`,
      comment,
    )
  }

  private handleAssignmentHover(node: any, comment: string): string {
    const t = this.checker.inferType(node.expression)
    const anno = node.typeAnnotation
      ? `（注解 ${this.formatType(node.typeAnnotation)}）`
      : ''
    return this.buildHoverContent(
      `变量 ${node.name}：${this.describeHoverType(t)}${anno}`,
      comment,
    )
  }

  private handleParamHover(node: any, comment: string): string {
    const typeInfo = node.typeAnnotation
      ? this.formatType(node.typeAnnotation)
      : 'any'
    return this.buildHoverContent(`参数 ${node.name}：${typeInfo}`, comment)
  }

  private handleMethodAllHover(node: MethodAll, comment: string): string {
    const params = node.params?.map((p: any) => p.name).join(', ') || ''
    const rest = node.restParam ? `, ...${node.restParam.name}` : ''
    const ret = node.returnType
      ? ` : ${this.formatType(node.returnType)}`
      : ''
    return this.buildHoverContent(
      `方法 ${this.extractName(node.name)}(${params}${rest})${ret}`,
      comment,
    )
  }

  private handleLambdaHover(node: LambdaDef, comment: string): string {
    const t = this.checker.inferType(node)
    if (t.kind === 'object' && t.methods) {
      const sig = t.methods.get('apply')?.[0]
      if (sig) {
        const params = (sig.params ?? [])
          .map((p: any) => (p ? describeType(p) : 'any'))
          .join(', ')
        return this.buildHoverContent(
          `λ(${params}) => ${describeType(sig.returns)}`,
          comment,
        )
      }
    }
    return this.buildHoverContent('λ（匿名函数）', comment)
  }

  private handleMessageHover(message: Message, comment: string): string {
    const name = this.getMethodCallName(message.name)
    const container = message.$container
    let receiverType: TypeInfo | undefined

    if (container && isMessageOrChain(container)) {
      receiverType = this.checker.inferType(container.primary)
    }

    if (receiverType) {
      const sig = this.findMethodSignature(receiverType, name)
      if (sig) {
        const params = (sig.params ?? [])
          .map((p: any) => (p ? describeType(p) : 'any'))
          .join(', ')
        const rest = sig.rest ? `, ...${describeType(sig.rest)}` : ''
        return this.buildHoverContent(
          `${describeType(receiverType)}.${name}(${params}${rest}) => ${describeType(sig.returns)}`,
          comment,
        )
      }
      return this.buildHoverContent(
        `消息 ${name} 发送给 ${describeType(receiverType)}`,
        comment,
      )
    }
    return this.buildHoverContent(`消息 ${name}`, comment)
  }

  private findMethodSignature(
    type: TypeInfo,
    name: string,
  ): { params: (TypeInfo | undefined)[]; rest?: TypeInfo; returns: TypeInfo } | undefined {
    if (type.kind === 'object') {
      const sigs = type.methods.get(name)
      if (sigs && sigs.length > 0) {
        return sigs[sigs.length - 1]
      }
    }
    if (type.kind === 'name') {
      const sigs = getBuiltinMethods(type.name).get(name)
      if (sigs && sigs.length > 0) {
        return sigs[sigs.length - 1]
      }
    }
    return undefined
  }

  private getMethodCallName(name: MethodCallName): string {
    const v = name.value
    if (isRef(v)) return v.value
    if (isStID(v)) return v.value.slice(1)
    if (v && typeof v === 'object' && 'value' in v) return String(v.value)
    return String(v)
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

  private extractNameFromDefName(nameNode: any): string | undefined {
    if (!nameNode) return undefined
    const innerName = nameNode.name
    if (!innerName) return undefined
    if (isRef(innerName)) return innerName.value
    if (isStID(innerName)) return innerName.value.slice(1)
    if (innerName && typeof innerName === 'object' && 'value' in innerName) {
      return String(innerName.value)
    }
    return String(innerName)
  }

  private extractName(nameNode: any): string {
    return this.extractNameFromDefName(nameNode) ?? ''
  }

  private formatType(type: any): string {
    if (!type) return 'any'
    return typeToString(type)
  }

  private describeHoverType(t: TypeInfo): string {
    if (!t) return 'any'
    if (t.kind === 'union') {
      const branches = t.types.map((x) => this.describeHoverType(x)).join(' | ')
      return `联合类型：${branches}`
    }
    if (t.kind === 'object') {
      const head = t.name
        ? `类型 ${t.name}${t.parent ? ` (extends ${t.parent})` : ''}`
        : `对象${t.parent ? ` (extends ${t.parent})` : ''}`
      const lines = [...t.methods.entries()].flatMap(([n, sigs]) =>
        (sigs as any[]).map((sig: any) => {
          const params = (sig.params ?? [])
            .map((p: any) => (p ? describeType(p) : 'any'))
            .join(', ')
          const rest = sig.rest ? `, ...${describeType(sig.rest)}` : ''
          return `${n}(${params}${rest}) => ${describeType(sig.returns)}`
        }),
      )
      return lines.length
        ? `${head}\n${lines.map((l) => `- ${l}`).join('\n')}`
        : head
    }
    return describeType(t)
  }

  private buildHoverContent(typeInfo: string, comment: string): string {
    if (comment) {
      return `${typeInfo}\n\n---\n\n${comment}`
    }
    return typeInfo
  }
}

type MaybePromise<T> = T | Promise<T>
