import { MaybePromise } from 'langium'
import { DefaultCompletionProvider, type CompletionAcceptor, type CompletionContext } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isRef,
  type Expression,
} from './generated/ast.js'
import {
  createImportResolver,
  ObjectOrientedCTypeChecker,
} from './type-checker.js'
import { CompletionItemKind } from 'vscode-languageserver'

/**
 * OOC 代码自动补全提供者
 * 提供：变量名、对象方法等补全建议
 */
export class ObjectOrientedCCompletionProvider extends DefaultCompletionProvider {
  private readonly checker: ObjectOrientedCTypeChecker

  constructor(services: ObjectOrientedCServices) {
    super(services)
    this.checker = new ObjectOrientedCTypeChecker(
      createImportResolver(
        services.shared.workspace.LangiumDocuments,
        services.LanguageMetaData.fileExtensions,
      ),
    )
  }

  protected override completionFor(
    context: CompletionContext,
    next: unknown,
    acceptor: CompletionAcceptor,
  ): MaybePromise<void> {
    // 先调用默认实现（关键字补全等）
    super.completionFor(context, next as any, acceptor)
    
    // 添加自定义补全：变量名、方法名等
    this.addCustomCompletions(context, acceptor)
  }

  /**
   * 添加自定义补全项
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
    
    // 向上遍历 AST，收集所有声明的变量
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
    // 处理包含表达式列表的节点
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