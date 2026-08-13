import type { CompletionParams, CancellationToken } from 'vscode-languageserver'
import { CompletionItem, CompletionItemKind, CompletionList } from 'vscode-languageserver'
import { CstUtils } from 'langium'
import { DefaultCompletionProvider } from 'langium/lsp'
import type { AstNode, LangiumDocument } from 'langium'
import type { LangiumServices } from 'langium/lsp'
import {
  isAssignment,
  isLambdaDef,
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
 * 继承 DefaultCompletionProvider，叠加 OOC 特有的变量和方法补全
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
    // 先尝试使用 findDeclarationNodeAtOffset（会调整 offset 以匹配标识符）
    let cstNode = CstUtils.findDeclarationNodeAtOffset(cstRoot, offset, this.grammarConfig.nameRegexp)
    // 如果找不到节点，或者找到的节点的 offset 与原始 offset 差距太大，
    // 则尝试使用原始 offset 直接查找
    if (!cstNode || Math.abs(cstNode.offset - offset) > 1) {
      cstNode = CstUtils.findLeafNodeAtOffset(cstRoot, offset)
    }
    const node = cstNode?.astNode

    if (node) {
      const variables = this.collectVisibleVariables(node)
      for (const [name, typeInfo] of variables) {
        items.push({
          label: name,
          kind: CompletionItemKind.Variable,
          detail: typeInfo,
        })
      }
    } else {
      // 如果找不到特定节点，则从根节点收集所有可见变量
      const variables = this.collectVisibleVariablesFromRoot(rootNode)
      for (const [name, typeInfo] of variables) {
        items.push({
          label: name,
          kind: CompletionItemKind.Variable,
          detail: typeInfo,
        })
      }
    }

    if (node && isRef(node)) {
      const methodItems = this.getMethodCompletions(node)
      items.push(...methodItems)
    }

    if (node && isMessageOrChain(node)) {
      const methodItems = this.getMessageChainCompletions(node)
      items.push(...methodItems)
    }

    return items
  }

  /**
   * 从根节点收集所有可见变量
   */
  private collectVisibleVariablesFromRoot(rootNode: AstNode): Map<string, string> {
    const result = new Map<string, string>()
    if (isModel(rootNode)) {
      for (const stmt of rootNode.expressions) {
        if (isAssignment(stmt)) {
          result.set(stmt.name, this.inferTypeString(stmt.expression))
        }
      }
    }
    return result
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
   * 获取 Ref 节点的方法补全项
   */
  private getMethodCompletions(node: AstNode): CompletionItem[] {
    const items: CompletionItem[] = []
    if (isRef(node)) {
      const t = this.checker.inferType(node)
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
    return items
  }

  /**
   * 获取 MessageChain 的方法补全项
   */
  private getMessageChainCompletions(node: AstNode): CompletionItem[] {
    const items: CompletionItem[] = []
    if (isMessageOrChain(node)) {
      const t = this.checker.inferType(node.primary)
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
    return items
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
