import type { CompletionParams, CancellationToken } from 'vscode-languageserver'
import { CompletionItem, CompletionItemKind, CompletionList } from 'vscode-languageserver'
import { CstUtils, isCompositeCstNode } from 'langium'
import { DefaultCompletionProvider } from 'langium/lsp'
import type { AstNode, CstNode, LangiumDocument } from 'langium'
import type { LangiumServices } from 'langium/lsp'
import {
  isAssignment,
  isLambdaDef,
  isModel,
  isMethodAll,
  isMethodBind,
  isMethodBindMutable,
  isObjectDef,
  type LambdaDef,
  type MethodAll,
} from './generated/ast.js'
import { getSharedChecker } from './shared-checker.js'
import {
  getMethodName,
  extractMethodDefName,
  inferParamType,
  inferTypeString,
  isBeforeCursor,
} from './completion-type-utils.js'
import { getContextualMethodCompletions } from './completion-methods.js'

/**
 * OOC 代码自动补全提供者
 *
 * 核心设计：
 * 1. 使用 findLastNodeBefore 找到光标位置前最近的 CST/AST 节点
 * 2. 分析上下文决定补全类型（变量/方法/参数）
 * 3. 正确处理尾部位置（光标在最后一个 token 之后）
 * 4. 变量位置感知：只收集光标前声明的变量
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
    const allItems = [...defaultItems, ...oocItems]
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

    const cstNode = this.findBestCstNode(cstRoot, offset)
    const node = cstNode?.astNode

    const variableItems = this.getVariableCompletions(node || rootNode, offset)
    items.push(...variableItems)

    const methodItems = getContextualMethodCompletions(this.checker, node, offset, text)
    items.push(...methodItems)

    return items
  }

  /**
   * 找到光标位置前最优的 CST 节点
   */
  private findBestCstNode(cstRoot: CstNode, offset: number): CstNode | undefined {
    const declNode = CstUtils.findDeclarationNodeAtOffset(cstRoot, offset, this.grammarConfig.nameRegexp)
    if (declNode) return declNode

    const leafNode = CstUtils.findLeafNodeAtOffset(cstRoot, offset)
    if (leafNode) return leafNode

    return this.findLastCstNodeBefore(cstRoot, offset)
  }

  /**
   * 找到 offset 之前最近的 CST 节点
   */
  private findLastCstNodeBefore(cstRoot: CstNode, offset: number): CstNode | undefined {
    let result: CstNode | undefined

    function walk(node: CstNode) {
      if (node.offset === undefined) return
      if (node.offset <= offset) {
        if (!result || node.offset > result.offset) {
          result = node
        }
      }
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
   * 获取变量补全项（只收集光标前声明的变量）
   */
  private getVariableCompletions(node: AstNode, offset: number): CompletionItem[] {
    const items: CompletionItem[] = []
    const variables = this.collectVisibleVariables(node, offset)
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
   * 收集当前可见的变量（向上遍历容器链）
   */
  private collectVisibleVariables(node: AstNode, offset: number): Map<string, string> {
    const result = new Map<string, string>()
    const visited = new Set<AstNode>()

    let current: AstNode | undefined = node
    while (current) {
      if (visited.has(current)) break
      visited.add(current)
      this.collectDeclarationsFromNode(current, result, offset)
      current = current.$container
    }

    return result
  }

  /**
   * 从节点收集变量声明和 lambda/方法参数
   * isModel 分支只收光标前的赋值；lambda/method 内部不过滤
   */
  private collectDeclarationsFromNode(node: AstNode, result: Map<string, string>, offset: number): void {
    if (isAssignment(node)) {
      result.set(node.name, inferTypeString(this.checker, node.expression))
    }

    if (isLambdaDef(node)) {
      const lambda = node as LambdaDef
      if (lambda.params) {
        for (const p of lambda.params) {
          result.set(p.name, inferParamType(p))
        }
      }
      if (lambda.expressions) {
        for (const expr of lambda.expressions) {
          if (isAssignment(expr)) {
            result.set(expr.name, inferTypeString(this.checker, expr.expression))
          }
        }
      }
    }

    if (isMethodAll(node)) {
      const method = node as MethodAll
      if (method.params) {
        for (const p of method.params) {
          result.set(p.name, inferParamType(p))
        }
      }
      if (method.expressions) {
        for (const expr of method.expressions) {
          if (isAssignment(expr)) {
            result.set(expr.name, inferTypeString(this.checker, expr.expression))
          }
        }
      }
    }

    if (isMethodBind(node)) {
      const name = extractMethodDefName(node.name)
      if (name) result.set(name, ': any')
    }

    if (isMethodBindMutable(node)) {
      const name = extractMethodDefName(node.name)
      if (name) result.set(name, ': any')
    }

    if (isModel(node)) {
      for (const stmt of node.expressions) {
        if (isAssignment(stmt) && isBeforeCursor(stmt, offset)) {
          result.set(stmt.name, inferTypeString(this.checker, stmt.expression))
        }
      }
    }

    if (isObjectDef(node)) {
      for (const method of node.methods) {
        if (isMethodAll(method)) {
          const name = getMethodName(method)
          if (name) result.set(name, ': method')
        } else if (isMethodBind(method)) {
          const name = extractMethodDefName(method.name)
          if (name) result.set(name, ': any')
        } else if (isMethodBindMutable(method)) {
          const name = extractMethodDefName(method.name)
          if (name) result.set(name, ': any')
        }
      }
    }
  }
}
