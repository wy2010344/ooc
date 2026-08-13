import {
  DefaultCompletionProvider,
} from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isLambdaDef,
  isMessageOrChain,
  isMethodAll,
  isRef,
  type Expression,
  type LambdaDef,
  type MethodAll,
  type Param,
} from './generated/ast.js'
import { getSharedChecker } from './shared-checker.js'
import { CompletionItem, CompletionItemKind, CompletionList } from 'vscode-languageserver'
import type { CompletionParams, CancellationToken } from 'vscode-languageserver'
import type { LangiumDocument } from 'langium'

/**
 * OOC 代码自动补全提供者
 *
 * 先调用默认补全（关键字、引用等），再追加自定义补全（变量、方法）
 */
export class ObjectOrientedCCompletionProvider extends DefaultCompletionProvider {
  private readonly checker: ReturnType<typeof getSharedChecker>

  constructor(services: ObjectOrientedCServices) {
    super(services)
    this.checker = getSharedChecker(services)
  }

  /**
   * 重写 getCompletion：先执行默认补全，再追加自定义补全
   */
  override getCompletion(
    document: LangiumDocument,
    params: CompletionParams,
    cancelToken?: CancellationToken,
  ): Promise<CompletionList | undefined> {
    const doCompletion = async (): Promise<CompletionList | undefined> => {
      // 1. 先执行默认补全（关键字、引用等）
      const defaultList = await super.getCompletion(document, params, cancelToken)

      // 2. 获取自定义补全项
      const customItems = this.getCustomCompletions(document, params.position)

      // 3. 合并结果
      const allItems: CompletionItem[] = []
      if (defaultList) {
        allItems.push(...defaultList.items)
      }
      allItems.push(...customItems)

      // 4. 去重并返回
      return CompletionList.create(this.deduplicateItems(allItems), true)
    }

    return doCompletion()
  }

  /**
   * 在指定位置获取自定义补全项
   */
  private getCustomCompletions(
    document: LangiumDocument,
    position: { line: number; character: number },
  ): CompletionItem[] {
    const items: CompletionItem[] = []
    const rootNode = document.parseResult?.value
    if (!rootNode) return items

    // 找到光标位置的节点
    const node = this.findNodeAtPosition(rootNode, document, position)
    if (!node) return items

    // 添加可见变量（包括 lambda 参数）
    const variables = this.collectVisibleVariables(node)
    for (const [name, typeInfo] of variables) {
      items.push({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: typeInfo,
      })
    }

    // 如果是 Ref 引用或 MessageOrChain，添加方法补全
    if (isRef(node)) {
      const methodItems = this.getMethodCompletions(node)
      items.push(...methodItems)
    }

    // 如果是 MessageOrChain，添加更多方法
    if (isMessageOrChain(node)) {
      const methodItems = this.getMessageChainCompletions(node)
      items.push(...methodItems)
    }

    return items
  }

  /**
   * 在文档中找到指定位置的节点
   */
  private findNodeAtPosition(root: any, document: LangiumDocument, position: { line: number; character: number }): any {
    const offset = document.textDocument.offsetAt(position)
    const cstNode = root.$cstNode
    if (!cstNode) return null

    // 遍历 CST 找到包含该位置的最小节点
    return this.traverseCstNode(cstNode, offset)?.astNode ?? null
  }

  /**
   * 遍历 CST 节点
   */
  private traverseCstNode(cstNode: any, offset: number): any {
    if (!cstNode || offset < cstNode.offset || offset > cstNode.offset + cstNode.length) {
      return null
    }

    if (cstNode.children && cstNode.children.length > 0) {
      for (const child of cstNode.children) {
        const found = this.traverseCstNode(child, offset)
        if (found) return found
      }
    }

    return cstNode
  }

  /**
   * 收集当前可见的变量（包括 lambda 参数）
   */
  private collectVisibleVariables(node: any): Map<string, string> {
    const result = new Map<string, string>()

    let current = node
    while (current) {
      this.collectDeclarationsFromNode(current, result)
      current = current.$container
    }

    return result
  }

  /**
   * 从节点收集变量声明和 lambda 参数
   */
  private collectDeclarationsFromNode(node: any, result: Map<string, string>): void {
    // 收集 Assignment（变量声明）
    if (isAssignment(node)) {
      result.set(node.name, this.inferTypeString(node.expression))
    }

    // 收集 LambdaDef 的 params
    if (isLambdaDef(node)) {
      const lambda = node as LambdaDef
      if (lambda.params) {
        for (const p of lambda.params) {
          result.set(p.name, this.inferParamType(p))
        }
      }
      // 收集 lambda 内部的 expressions（嵌套 Assignment）
      if (lambda.expressions) {
        for (const expr of lambda.expressions) {
          if (isAssignment(expr)) {
            result.set(expr.name, this.inferTypeString(expr.expression))
          }
        }
      }
    }

    // 收集 MethodAll 的 params
    if (isMethodAll(node)) {
      const method = node as MethodAll
      if (method.params) {
        for (const p of method.params) {
          result.set(p.name, this.inferParamType(p))
        }
      }
    }

    // 收集通用的子节点
    if ('expressions' in node && Array.isArray(node.expressions)) {
      for (const expr of node.expressions) {
        if (isAssignment(expr)) {
          result.set(expr.name, this.inferTypeString(expr.expression))
        }
      }
    }
  }

  /**
   * 推断参数类型
   */
  private inferParamType(p: Param): string {
    if (p.typeAnnotation) {
      return 'type' // 简化处理
    }
    return 'any'
  }

  /**
   * 推断表达式类型并转为字符串
   */
  private inferTypeString(expr: Expression): string {
    try {
      if (this.checker) {
        const t = this.checker.inferType(expr)
        return this.formatTypeDetail(t)
      }
    } catch {
      // 忽略类型推断错误
    }
    return 'any'
  }

  /**
   * 格式化类型信息
   */
  private formatTypeDetail(t: any): string {
    if (!t) return 'any'
    switch (t.kind) {
      case 'any':
        return 'any'
      case 'name':
        return t.name
      case 'object':
        return t.name ?? '对象'
      case 'union':
        return t.types.map((x: any) => this.formatTypeDetail(x)).join(' | ')
      case 'literal':
        return typeof t.value === 'string' ? `'${t.value}'` : String(t.value)
      default:
        return 'any'
    }
  }

  /**
   * 获取 Ref 节点的方法补全项
   */
  private getMethodCompletions(node: any): CompletionItem[] {
    const items: CompletionItem[] = []
    try {
      if (this.checker) {
        const t = this.checker.inferType(node)
        if (t?.kind === 'object' && t.methods) {
          for (const [methodName, sigs] of t.methods) {
            const sig = (sigs as any[])[(sigs as any[]).length - 1]
            const params = (sig.params ?? [])
              .map((p: any) => (p ? this.formatTypeDetail(p) : 'any'))
              .join(', ')
            items.push({
              label: methodName,
              kind: CompletionItemKind.Method,
              detail: `${methodName}(${params}) => ${this.formatTypeDetail(sig.returns)}`,
            })
          }
        }
      }
    } catch {
      // 忽略类型推断错误
    }
    return items
  }

  /**
   * 获取 MessageChain 的方法补全项
   */
  private getMessageChainCompletions(node: any): CompletionItem[] {
    const items: CompletionItem[] = []
    try {
      if (this.checker && node.primary) {
        const t = this.checker.inferType(node.primary)
        if (t?.kind === 'object' && t.methods) {
          for (const [methodName, sigs] of t.methods) {
            const sig = (sigs as any[])[(sigs as any[]).length - 1]
            const params = (sig.params ?? [])
              .map((p: any) => (p ? this.formatTypeDetail(p) : 'any'))
              .join(', ')
            items.push({
              label: methodName,
              kind: CompletionItemKind.Method,
              detail: `${methodName}(${params}) => ${this.formatTypeDetail(sig.returns)}`,
            })
          }
        }
      }
    } catch {
      // 忽略类型推断错误
    }
    return items
  }
}
