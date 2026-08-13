import { MaybePromise } from 'langium'
import { DefaultCompletionProvider, type CompletionAcceptor, type CompletionContext } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isRef,
  type Expression,
} from './generated/ast.js'
import { getSharedChecker } from './shared-checker.js'
import { CompletionItemKind } from 'vscode-languageserver'

/**
 * OOC 代码自动补全提供者
 * 只添加自定义补全，不遮避 Langium 默认补全
 */
export class ObjectOrientedCCompletionProvider extends DefaultCompletionProvider {
  private readonly checker: ReturnType<typeof getSharedChecker>

  constructor(services: ObjectOrientedCServices) {
    super(services)
    this.checker = getSharedChecker(services)
  }

  protected override completionFor(
    context: CompletionContext,
    next: unknown,
    acceptor: CompletionAcceptor,
  ): MaybePromise<void> {
    // 先调用默认实现（关键字补全等）
    super.completionFor(context, next as any, acceptor)
    
    // 追加自定义补全：使用 queue 模式而非替换
    this.addCustomCompletions(context, acceptor)
  }

  /**
   * 添加自定义补全项（变量名、方法名）
   */
  private addCustomCompletions(
    context: CompletionContext,
    acceptor: CompletionAcceptor,
  ): void {
    const node = context.node
    if (!node) return

    // 查找当前作用域的变量
    const variables = this.collectVisibleVariables(node)
    
    for (const [name, typeInfo] of variables) {
      acceptor(context, {
        label: name,
        kind: CompletionItemKind.Variable,
        detail: this.formatTypeDetail(typeInfo),
      })
    }

    // 如果是 Ref 引用，添加接收者的方法
    if (isRef(node)) {
      this.addMethodCompletions(node, context, acceptor)
    }
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
  private collectDeclarations(
    node: any,
    result: Map<string, string>,
  ): void {
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
   * 添加方法补全
   */
  private addMethodCompletions(
    node: any,
    context: CompletionContext,
    acceptor: CompletionAcceptor,
  ): void {
    try {
      const t = this.checker.inferType(node)
      if (t.kind === 'object') {
        for (const [methodName, sigs] of t.methods) {
          const sig = (sigs as any[])[(sigs as any[]).length - 1]
          const params = (sig.params ?? [])
            .map((p: any) => (p ? this.formatTypeDetail(p) : 'any'))
            .join(', ')
          acceptor(context, {
            label: methodName,
            kind: CompletionItemKind.Method,
            detail: `${methodName}(${params}) => ${this.formatTypeDetail(sig.returns)}`,
          })
        }
      }
    } catch {
      // 忽略类型推断错误
    }
  }
}
