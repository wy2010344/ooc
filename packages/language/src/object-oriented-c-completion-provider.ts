import {
  DefaultCompletionProvider,
} from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isRef,
  type Expression,
} from './generated/ast.js'
import { getSharedChecker } from './shared-checker.js'
import { CompletionItem, CompletionItemKind, CompletionList, Position } from 'vscode-languageserver'
import type { CompletionParams, CancellationToken } from 'vscode-languageserver'
import type { LangiumDocument } from 'langium'

/**
 * OOC 代码自动补全提供者
 *
 * 设计说明：
 * - Langium 的 DefaultCompletionProvider 会在 getCompletion 中遍历所有 context.features
 * - 对每个 feature 调用 completionFor，这会导致我们的自定义逻辑被重复触发
 * - 因此我们改为重写 getCompletion，在默认补全完成后追加自定义补全
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
    position: Position,
  ): CompletionItem[] {
    const items: CompletionItem[] = []
    const rootNode = document.parseResult?.value
    if (!rootNode) return items

    // 找到光标位置的节点
    const node = this.findNodeAt(rootNode, document, position)
    if (!node) return items

    // 添加变量补全
    const variables = this.collectVisibleVariables(node)
    for (const [name, typeInfo] of variables) {
      items.push({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: this.formatTypeDetail(typeInfo),
      })
    }

    // 如果是 Ref 引用，添加接收者的方法
    if (isRef(node)) {
      const methodItems = this.getMethodCompletions(node)
      items.push(...methodItems)
    }

    return items
  }

  /**
   * 在文档中找到指定位置的节点
   */
  private findNodeAt(root: any, document: LangiumDocument, position: Position): any {
    // 获取偏移量
    const offset = document.textDocument.offsetAt(position)

    // 遍历 AST 找到包含该位置的最小节点
    let node = root
    while (node) {
      let child: any = null
      if (node.$children) {
        for (const c of node.$children) {
          if (this.isNodeAt(c, offset)) {
            child = c
            break
          }
        }
      }
      if (!child) break
      node = child
    }
    return node
  }

  /**
   * 检查节点是否在指定偏移处
   */
  private isNodeAt(node: any, offset: number): boolean {
    if (!node.$cstNode) return false
    const range = node.$cstNode.root?.textRegion
    if (!range) return false
    return range.start <= offset && offset <= range.end
  }

  /**
   * 收集当前可见的变量
   */
  private collectVisibleVariables(node: any): Map<string, string> {
    const result = new Map<string, string>()

    let current = node
    while (current) {
      this.collectDeclarations(current, result)
      current = current.$container
    }

    return result
  }

  /**
   * 从节点收集变量声明
   */
  private collectDeclarations(node: any, result: Map<string, string>): void {
    if (isAssignment(node)) {
      result.set(node.name, this.inferTypeString(node.expression))
    }
    if ('expressions' in node && Array.isArray(node.expressions)) {
      for (const expr of node.expressions) {
        if (isAssignment(expr)) {
          result.set(expr.name, this.inferTypeString(expr.expression))
        }
      }
    }
  }

  /**
   * 推断表达式类型并转为字符串
   */
  private inferTypeString(expr: Expression): string {
    try {
      const t = this.checker.inferType(expr)
      return this.formatTypeDetail(t)
    } catch {
      return 'any'
    }
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
   * 获取方法补全项
   */
  private getMethodCompletions(node: any): CompletionItem[] {
    const items: CompletionItem[] = []
    try {
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
    } catch {
      // 忽略类型推断错误
    }
    return items
  }
}
