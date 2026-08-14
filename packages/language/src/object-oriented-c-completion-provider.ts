import type { CompletionParams, CancellationToken } from 'vscode-languageserver'
import { CompletionItem, CompletionItemKind, CompletionList } from 'vscode-languageserver'
import { CstUtils, isCompositeCstNode } from 'langium'
import { DefaultCompletionProvider } from 'langium/lsp'
import type { AstNode, CstNode, LangiumDocument } from 'langium'
import type { LangiumServices } from 'langium/lsp'
import {
  isAssignment,
  isLambdaDef,
  isMessage,
  isMessageOrChain,
  isRef,
  isModel,
  isMethodAll,
  isMethodBind,
  isMethodBindMutable,
  isObjectDef,
  type Expression,
  type LambdaDef,
  type MethodAll,
  type Param,
} from './generated/ast.js'
import { getSharedChecker } from './shared-checker.js'
import { describeType, type TypeInfo } from './type-system.js'

/**
 * OOC 代码自动补全提供者
 * 
 * 核心设计：
 * 1. 使用 findLastNodeBefore 找到光标位置前最近的 CST/AST 节点
 * 2. 分析上下文决定补全类型（变量/方法/参数）
 * 3. 正确处理尾部位置（光标在最后一个 token 之后）
 */
export class ObjectOrientedCCompletionProvider extends DefaultCompletionProvider {
  private readonly checker: ReturnType<typeof getSharedChecker>

  constructor(services: LangiumServices) {
    super(services)
    this.checker = getSharedChecker(services)
  }

  /**
   * 获取补全项：在默认补全基础上叠加 OOC 变量和方法补全
   */
  override async getCompletion(
    document: LangiumDocument,
    params: CompletionParams,
    cancelToken?: CancellationToken,
  ): Promise<CompletionList | undefined> {
    const defaultItems: CompletionItem[] = []
    const defaultResult = await super.getCompletion(document, params, cancelToken)
    if (defaultResult) {
      for (const item of defaultResult.items) {
        defaultItems.push(item)
      }
    }

    const oocItems = this.getOocCompletions(document, params)
    const allItems = this.deduplicateItems([...defaultItems, ...oocItems])
    return CompletionList.create(allItems, true)
  }

  /**
   * OOC 特有的补全：变量、方法、关键字
   */
  private getOocCompletions(
    document: LangiumDocument,
    params: CompletionParams,
  ): CompletionItem[] {
    const items: CompletionItem[] = []
    const rootNode = document.parseResult?.value
    if (!rootNode) return items

    const cstRoot = (rootNode as any).$cstNode
    if (!cstRoot) return items

    const offset = document.textDocument.offsetAt(params.position)
    const text = document.textDocument.getText() || ''

    // 找到光标位置前最近的 CST 节点
    const cstNode = this.findBestCstNode(cstRoot, offset)
    const node = cstNode?.astNode

    // 收集可见变量（基于找到的节点或根节点）
    const variableItems = this.getVariableCompletions(node || rootNode)
    items.push(...variableItems)

    // 方法补全：基于上下文推断
    const methodItems = this.getContextualMethodCompletions(node, offset, text)
    items.push(...methodItems)

    return items
  }

  /**
   * 找到光标位置前最优的 CST 节点
   * 
   * 策略：
   * 1. 先尝试 findDeclarationNodeAtOffset（精确匹配标识符）
   * 2. 如果失败，使用 findLastNodeBefore（找到光标前最近的节点）
   */
  private findBestCstNode(cstRoot: CstNode, offset: number): CstNode | undefined {
    // 策略1: 使用 findDeclarationNodeAtOffset
    const declNode = CstUtils.findDeclarationNodeAtOffset(cstRoot, offset, this.grammarConfig.nameRegexp)
    if (declNode) return declNode

    // 策略2: 尝试 findLeafNodeAtOffset（用于光标在节点内部的情况）
    const leafNode = CstUtils.findLeafNodeAtOffset(cstRoot, offset)
    if (leafNode) return leafNode

    // 策略3: 找到光标前最近的 CST 节点
    return this.findLastCstNodeBefore(cstRoot, offset)
  }

  /**
   * 找到 offset 之前最近的 CST 节点
   * 用于处理光标在 token 之后的情况
   */
  private findLastCstNodeBefore(cstRoot: CstNode, offset: number): CstNode | undefined {
    let result: CstNode | undefined

    function walk(node: CstNode) {
      if (node.offset === undefined) return

      // 光标在节点内部或之后
      if (node.offset <= offset) {
        // 记录这个节点（如果它比之前的结果更靠近光标）
        if (!result || node.offset > result.offset) {
          result = node
        }
      }

      // 继续遍历子节点（寻找更精确的匹配）
      if (isCompositeCstNode(node) && node.content) {
        for (const child of node.content) {
          if (child.offset <= offset) {
            walk(child)
          }
        }
      }
    }

    walk(cstRoot)
    return result
  }

  /**
   * 获取变量补全项
   */
  private getVariableCompletions(node: AstNode): CompletionItem[] {
    const items: CompletionItem[] = []
    const variables = this.collectVisibleVariables(node)
    for (const [name, typeInfo] of variables) {
      items.push({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: typeInfo,
      })
    }
    return items
  }

  /**
   * 基于上下文获取方法补全
   */
  private getContextualMethodCompletions(
    node: AstNode | undefined,
    offset: number,
    text: string,
  ): CompletionItem[] {
    if (!node) return []

    // 场景1: 光标在 Ref 节点上 → 补全该对象的方法
    if (isRef(node)) {
      return this.getMethodCompletionsFromRef(node)
    }

    // 场景2: 光标在 MessageOrChain 上 → 补全该对象的方法
    if (isMessageOrChain(node)) {
      return this.getMessageChainCompletions(node)
    }

    // 场景3: 光标在 Message 上 → 补全该对象的方法
    if (isMessage(node)) {
      const container = node.$container
      if (container && isMessageOrChain(container)) {
        return this.getMessageChainCompletions(container)
      }
    }

    // 场景4: 尾部位置 - 检查光标前是否有 Ref
    const textBefore = text.substring(0, offset).trimEnd()
    if (textBefore.length > 0) {
      const lastIdent = this.findLastIdentifier(textBefore)
      if (lastIdent) {
        // 从根节点查找这个标识符
        return this.getMethodCompletionsByName(node, lastIdent)
      }
    }

    return []
  }

  /**
   * 从文本中找到最后一个标识符
   */
  private findLastIdentifier(text: string): string | undefined {
    const match = text.match(/[a-zA-Z_][a-zA-Z0-9_]*\s*$/)
    if (!match) return undefined
    return match[0].trim()
  }

  /**
   * 从 Ref 节点获取方法补全
   */
  private getMethodCompletionsFromRef(refNode: AstNode): CompletionItem[] {
    const items: CompletionItem[] = []
    const t = this.checker.inferType(refNode)
    if (t?.kind === 'object' && t.methods) {
      for (const [methodName, sigs] of t.methods) {
        const sig = (sigs as any[])[(sigs as any[]).length - 1]
        const params = (sig.params ?? [])
          .map((p: any) => (p ? describeType(p) : 'any'))
          .join(', ')
        items.push({
          label: methodName,
          kind: CompletionItemKind.Method,
          detail: `${methodName}(${params}) => ${describeType(sig.returns)}`,
        })
      }
    }
    return items
  }

  /**
   * 从 MessageOrChain 节点获取方法补全
   */
  private getMessageChainCompletions(chainNode: AstNode): CompletionItem[] {
    const items: CompletionItem[] = []
    if (isMessageOrChain(chainNode)) {
      // 获取 primary（接收者）的类型
      const primary = chainNode.primary
      if (primary) {
        const t = this.checker.inferType(primary)
        if (t?.kind === 'object' && t.methods) {
          for (const [methodName, sigs] of t.methods) {
            const sig = (sigs as any[])[(sigs as any[]).length - 1]
            const params = (sig.params ?? [])
              .map((p: any) => (p ? describeType(p) : 'any'))
              .join(', ')
            items.push({
              label: methodName,
              kind: CompletionItemKind.Method,
              detail: `${methodName}(${params}) => ${describeType(sig.returns)}`,
            })
          }
        }
      }
    }
    return items
  }

  /**
   * 按名称查找变量并返回其方法
   */
  private getMethodCompletionsByName(currentNode: AstNode, name: string): CompletionItem[] {
    const items: CompletionItem[] = []
    
    // 遍历容器链查找变量定义
    let cur: AstNode | undefined = currentNode
    while (cur) {
      // 在当前节点中查找变量
      const varNode = this.findVariableByName(cur, name)
      if (varNode && isRef(varNode)) {
        return this.getMethodCompletionsFromRef(varNode)
      }
      cur = cur.$container
    }
    
    return items
  }

  /**
   * 在节点中按名称查找变量
   */
  private findVariableByName(node: AstNode, name: string): AstNode | undefined {
    if (isModel(node)) {
      for (const stmt of node.expressions) {
        if (isAssignment(stmt) && stmt.name === name) {
          // 返回 expression 部分的 Ref（如果存在）
          if (stmt.expression && isRef(stmt.expression)) {
            return stmt.expression
          }
          return stmt
        }
      }
    }
    if (isAssignment(node) && node.name === name) {
      if (node.expression && isRef(node.expression)) {
        return node.expression
      }
    }
    return undefined
  }

  /**
   * 收集当前可见的变量（向上遍历容器链）
   */
  private collectVisibleVariables(node: AstNode): Map<string, string> {
    const result = new Map<string, string>()
    const visited = new Set<AstNode>()

    let current: AstNode | undefined = node
    while (current) {
      if (visited.has(current)) break
      visited.add(current)
      this.collectDeclarationsFromNode(current, result)
      current = current.$container
    }

    return result
  }

  /**
   * 从节点收集变量声明和 lambda/方法参数
   */
  private collectDeclarationsFromNode(node: AstNode, result: Map<string, string>): void {
    if (isAssignment(node)) {
      result.set(node.name, this.inferTypeString(node.expression))
    }

    if (isLambdaDef(node)) {
      const lambda = node as LambdaDef
      if (lambda.params) {
        for (const p of lambda.params) {
          result.set(p.name, this.inferParamType(p))
        }
      }
      if (lambda.expressions) {
        for (const expr of lambda.expressions) {
          if (isAssignment(expr)) {
            result.set(expr.name, this.inferTypeString(expr.expression))
          }
        }
      }
    }

    if (isMethodAll(node)) {
      const method = node as MethodAll
      if (method.params) {
        for (const p of method.params) {
          result.set(p.name, this.inferParamType(p))
        }
      }
      if (method.expressions) {
        for (const expr of method.expressions) {
          if (isAssignment(expr)) {
            result.set(expr.name, this.inferTypeString(expr.expression))
          }
        }
      }
    }

    if (isMethodBind(node)) {
      const name = this.extractMethodDefName(node.name)
      if (name) result.set(name, ': any')
    }

    if (isMethodBindMutable(node)) {
      const name = this.extractMethodDefName(node.name)
      if (name) result.set(name, ': any')
    }

    if (isModel(node)) {
      for (const stmt of node.expressions) {
        if (isAssignment(stmt)) {
          result.set(stmt.name, this.inferTypeString(stmt.expression))
        }
      }
    }

    if (isObjectDef(node)) {
      for (const method of node.methods) {
        if (isMethodAll(method)) {
          const name = this.getMethodName(method)
          if (name) result.set(name, ': method')
        } else if (isMethodBind(method)) {
          const name = this.extractMethodDefName(method.name)
          if (name) result.set(name, ': any')
        } else if (isMethodBindMutable(method)) {
          const name = this.extractMethodDefName(method.name)
          if (name) result.set(name, ': any')
        }
      }
    }
  }

  /**
   * 推断参数类型
   */
  private inferParamType(p: Param): string {
    if (p.typeAnnotation) {
      return `: ${this.formatType(p.typeAnnotation)}`
    }
    return ': any'
  }

  /**
   * 推断表达式类型并转为字符串
   */
  private inferTypeString(expr: Expression): string {
    const t = this.checker.inferType(expr)
    return `: ${this.formatTypeInfo(t)}`
  }

  private formatType(type: any): string {
    if (!type) return 'any'
    if (typeof type === 'string') return type
    if (type.parts) {
      return type.parts.map((p: any) => {
        let name = p.name
        if (typeof name === 'string') return name
        if (name && typeof name === 'object' && 'value' in name) return String(name.value)
        return String(name)
      }).join(' | ')
    }
    return 'any'
  }

  private formatTypeInfo(t: TypeInfo): string {
    if (!t) return 'any'
    return describeType(t)
  }

  /**
   * 获取 MethodAll 的方法名
   */
  private getMethodName(method: MethodAll): string | undefined {
    return this.extractMethodDefName(method.name)
  }

  /**
   * 从 MethodDefName 提取字符串值
   */
  private extractMethodDefName(nameNode: any): string | undefined {
    if (!nameNode) return undefined
    const innerName = nameNode.name
    if (!innerName) return undefined
    if (isRef(innerName)) return innerName.value
    if (innerName.$type === 'StID') return innerName.value.replace(/^"/, '').replace(/"$/, '')
    if (innerName.$type === 'Str') return innerName.value.replace(/^'/, '').replace(/'$/, '')
    return undefined
  }
}
