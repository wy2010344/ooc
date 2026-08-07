import { AstNode, MaybePromise } from 'langium'
import { AstNodeHoverProvider } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isExpression,
  isLambdaDef,
  isMethodAll,
  isMethodBind,
  isPrimary,
} from './generated/ast.js'
import { ObjectOrientedCTypeChecker } from './type-checker.js'
import {
  describeType,
  typeToString,
  type TypeInfo,
} from './type-system.js'

export class ObjectOrientedCHoverProvider extends AstNodeHoverProvider {
  private readonly checker = new ObjectOrientedCTypeChecker()

  constructor(services: ObjectOrientedCServices) {
    super(services)
  }

  protected override getAstNodeHoverContent(
    node: AstNode,
  ): MaybePromise<string | undefined> {
    if (isMethodAll(node)) {
      const params = node.params?.map((p) => p.name).join(', ') || ''
      const ret = node.returnType
        ? ` : ${typeToString(node.returnType)}`
        : ''
      return `方法 ${node.name}(${params})${ret}`
    }
    if (isMethodBind(node)) {
      return `绑定 ${node.name}`
    }
    if (isLambdaDef(node)) {
      const params = node.params?.map((p) => p.name).join(', ') || ''
      return `λ(${params}) => 函数`
    }
    if (isAssignment(node)) {
      const t = this.checker.inferType(node.expression)
      const anno = node.typeAnnotation
        ? `（注解 ${typeToString(node.typeAnnotation)}）`
        : ''
      return `变量 ${node.name}：${describeHoverType(t)}${anno}`
    }
    if (isExpression(node) || isPrimary(node)) {
      const t = this.checker.inferType(node)
      return describeHoverType(t)
    }
    return undefined
  }
}

/**
 * 对象的悬停展示：列出方法签名，方便在编辑器里查看对象形状。
 */
function describeHoverType(t: TypeInfo): string {
  if (t.kind === 'object') {
    const head = t.name ? `类型 ${t.name}` : '对象'
    const lines = [...t.methods.entries()].flatMap(([name, sigs]) =>
      sigs.map((sig) => {
        const params = (sig.params ?? [])
          .map((p) => (p ? describeType(p) : 'any'))
          .join(', ')
        const rest = sig.rest ? `, ...${describeType(sig.rest)}` : ''
        return `${name}(${params}${rest}) => ${describeType(sig.returns)}`
      }),
    )
    return lines.length ? `${head}\n${lines.join('\n')}` : head
  }
  return describeType(t)
}
