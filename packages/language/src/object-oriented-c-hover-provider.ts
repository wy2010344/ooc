import { Hover, HoverParams } from 'vscode-languageserver'
import { AstUtils, CstUtils } from 'langium'
import { AstNodeHoverProvider } from 'langium/lsp'
import type { AstNode, CstNode, LangiumDocument } from 'langium'
import type { LangiumServices } from 'langium/lsp'
import {
  isAssignment,
  isBool,
  isExpression,
  isImportItem,
  isImportStatement,
  isLambdaDef,
  isMessage,
  isMessageOrChain,
  isMethodAll,
  isMethodBind,
  isMethodBindMutable,
  isModel,
  isNil,
  isNum,
  isPrimary,
  isRef,
  isStr,
  isStID,
  isDollar,
  isParam,
  type LambdaDef,
  type Message,
  type MethodAll,
  type MethodBind,
  type MethodBindMutable,
  type MethodCallName,
} from './generated/ast.js'
import { APPLY_NAME, displayMemberName } from './member-kind.js'
import { getSharedChecker } from './shared-checker.js'
import {
  findExportedNode,
  findImportBinding,
  findModuleResultNode,
  importDocument,
  type ImportBinding,
  type ImportResolution,
} from './import-binding.js'
import {
  describeType,
  getBuiltinMethods,
  typeToString,
  type TypeInfo,
} from './type-system.js'

/** #import 绑定形态的中文标签 */
const IMPORT_KIND_LABEL: Record<ImportBinding['kind'], string> = {
  named: '命名导入',
  default: '默认导入',
  type: '类型导入',
}

/**
 * OOC Hover 提供者
 * 继承 AstNodeHoverProvider，覆盖引用解析以支持 OOC 基于名称的引用
 */
export class ObjectOrientedCHoverProvider extends AstNodeHoverProvider {
  private readonly checker: ReturnType<typeof getSharedChecker>

  constructor(private readonly services: LangiumServices) {
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
      // 导入绑定：合并「类型 + 来源模块 + 本体声明」三块信息
      if (this.findBindingOf(astNode)) {
        const imported = this.handleRefHover(
          astNode,
          this.commentOfNode(astNode),
        )
        if (typeof imported === 'string' && imported.length > 0) {
          return { contents: { kind: 'markdown', value: imported } }
        }
      }
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
   * 解析 Ref 引用到其声明节点：先找本文件的作用域声明，
   * 找不到再走 #import 绑定（跳到被导入模块里的那条声明）。
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
      const found = this.findDeclarationInNode(root, name, visited)
      if (found) return found
    }

    return this.resolveImportedDeclaration(node, name)
  }

  /** 走 #import 绑定解析被导入模块里的声明（模块未加载/名字非顶层声明时返回 undefined） */
  private resolveImportedDeclaration(
    node: AstNode,
    name: string,
  ): AstNode | undefined {
    const model = AstUtils.getContainerOfType(node, isModel)
    if (!model) return undefined
    const binding = findImportBinding(model, name)
    if (!binding) return undefined
    const res = this.importResolution()
    const target = importDocument(binding.stmt, res)
    const targetModel = target?.parseResult.value
    if (!targetModel || !isModel(targetModel)) return undefined
    return binding.kind === 'default'
      ? findModuleResultNode(targetModel)
      : findExportedNode(targetModel, binding.exportName, res)
  }

  /** HoverProvider 侧的 #import 解析上下文 */
  private importResolution(): ImportResolution {
    const workspace = this.services.shared.workspace
    return {
      getDocument: (uri) => workspace.LangiumDocuments.getDocument(uri),
      exists: (uri) => workspace.FileSystemProvider.existsSync(uri),
      extensions: this.services.LanguageMetaData.fileExtensions,
    }
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
      const named = node.named
        ? `命名导入 ${node.named.items.map((i) => i.alias ?? i.name).join(', ')}`
        : ''
      const types = node.types
        ? `类型导入 ${node.types.items.map((i) => i.alias ?? i.name).join(', ')}`
        : ''
      const parts = [named, types].filter(Boolean).join('；')
      return this.buildHoverContent(
        parts ? parts : `导入 ${node.name ?? node.path}`,
        comment,
      )
    }

    if (isImportItem(node)) {
      return this.handleImportItemHover(node, comment)
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
      return this.buildHoverContent(
        `转发属性 ${this.extractName(node.name)}（消息转发给委托对象的 $）`,
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

    // `$` 是直接调用（apply 消息）：悬停在 `$` 上按它所在的消息名解析
    if (isDollar(node)) {
      const message = node.$container?.$container
      if (message && isMessage(message)) {
        return this.handleMessageHover(message, comment)
      }
      return this.buildHoverContent('$（直接调用）', comment)
    }

    if (isExpression(node) || isPrimary(node)) {
      const t = this.checker.inferType(node)
      return this.buildHoverContent(this.describeHoverType(t), comment)
    }

    return undefined
  }

  private handleRefHover(node: any, comment: string): string {
    const binding = this.findBindingOf(node)
    if (!binding) {
      const t = this.checker.inferType(node)
      return this.buildHoverContent(
        `引用 ${node.value}：${this.describeHoverType(t)}`,
        comment,
      )
    }
    // 导入绑定：类型 + 来源模块 + 本体声明（本体已含类型时不再重复列一遍）
    const t =
      this.checker.inferImportBindings(binding.stmt).get(binding.localName) ??
      this.checker.inferType(node)
    const alias =
      binding.exportName === binding.localName ? '' : `（原名 ${binding.exportName}）`
    const source = `${IMPORT_KIND_LABEL[binding.kind]}自 '${binding.stmt.path}'${alias}`
    const target = this.resolveImportedDeclaration(node, node.value)
    const body = target
      ? this.getAstNodeHoverContentImpl(target, this.commentOfNode(target))
      : undefined
    const head = body
      ? `导入 ${binding.localName}（${source}）`
      : `导入 ${binding.localName}（${source}）：${this.describeHoverType(t)}`
    return this.buildHoverContent(
      [head, body].filter(Boolean).join('\n\n'),
      comment,
    )
  }

  /** 该 Ref 是否命中某个 #import 绑定 */
  private findBindingOf(node: AstNode): ImportBinding | undefined {
    if (!isRef(node) || !node.value) return undefined
    const model = AstUtils.getContainerOfType(node, isModel)
    return model ? findImportBinding(model, node.value) : undefined
  }

  /** 节点自身的注释（跨文档也适用） */
  private commentOfNode(node: AstNode): string {
    const cstNode = (node as any).$cstNode
    return cstNode ? this.getNodeComment(cstNode) : ''
  }

  /** 导入项本体（`#import { Button }` 里的 Button）的悬停内容 */
  private handleImportItemHover(node: any, comment: string): string | undefined {
    const stmt = node.$container?.$container
    if (!stmt || !isImportStatement(stmt)) return undefined
    const isType = !!stmt.types?.items.includes(node)
    const alias = node.alias ? `（原名 ${node.name}）` : ''
    const t = this.checker.inferImportBindings(stmt).get(node.alias ?? node.name)
    const typeText = t ? `：${this.describeHoverType(t)}` : ''
    return this.buildHoverContent(
      `${isType ? '类型导入' : '命名导入'} ${node.alias ?? node.name}${alias} ← '${stmt.path}'${typeText}`,
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
    const name = this.extractName(node.name)
    // 零参无泛型 = 属性成员：hover 显示属性形态（与 d.ts/类型对象一致）
    const isProp =
      (node.params?.length ?? 0) === 0 &&
      !node.restParam &&
      (node.typeParams?.length ?? 0) === 0
    return this.buildHoverContent(
      isProp ? `属性 ${name}${ret}` : `方法 ${name}(${params}${rest})${ret}`,
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
    // apply 成员的 surface 写法是 `$`，悬停展示归一
    const display = displayMemberName(name)
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
          `${describeType(receiverType)}.${display}(${params}${rest}) => ${describeType(sig.returns)}`,
          comment,
        )
      }
      return this.buildHoverContent(
        `消息 ${display} 发送给 ${describeType(receiverType)}`,
        comment,
      )
    }
    return this.buildHoverContent(`消息 ${display}`, comment)
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
    if (isDollar(v)) return APPLY_NAME
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
    if (isDollar(innerName)) return APPLY_NAME
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
      const head = t.name ? `类型 ${t.name}` : '对象'
      const lines = [...t.methods.entries()].flatMap(([n, sigs]) =>
        (sigs as any[]).map((sig: any) => {
          const memberName = displayMemberName(n)
          const params = (sig.params ?? [])
            .map((p: any) => (p ? describeType(p) : 'any'))
            .join(', ')
          const rest = sig.rest ? `, ...${describeType(sig.rest)}` : ''
          // 零参无泛型成员渲染为属性形态（判别字段），与 d.ts 一致
          if ((sig.params ?? []).length === 0 && !sig.rest && !sig.typeParams) {
            return `${memberName}: ${describeType(sig.returns)}`
          }
          return `${memberName}(${params}${rest}) => ${describeType(sig.returns)}`
        }),
      )
      return lines.length
        ? `${head}\n${lines.map((l) => `- ${l}`).join('\n')}`
        : head
    }
    if (t.kind === 'intersection') {
      const members = t.types
        .map((x) => this.describeHoverType(x))
        .join(' 与 ')
      return `交集类型：${members}`
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
