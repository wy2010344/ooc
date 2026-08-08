import { AstNode, MaybePromise } from 'langium'
import { AstNodeHoverProvider } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isExpression,
  isImportStatement,
  isLambdaDef,
  isMethodAll,
  isMethodBind,
  isPrimary,
  isRef,
  isStID,
} from './generated/ast.js'
import {
  createImportResolver,
  ObjectOrientedCTypeChecker,
} from './type-checker.js'
import {
  describeType,
  typeToString,
  type TypeInfo,
} from './type-system.js'

export class ObjectOrientedCHoverProvider extends AstNodeHoverProvider {
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

  protected override getAstNodeHoverContent(
    node: AstNode,
  ): MaybePromise<string | undefined> {
    if (isImportStatement(node)) {
      return `导入 ${node.name}：${describeHoverType(this.checker.inferType(node))}`
    }
    if (isMethodAll(node)) {
      const params = node.params?.map((p) => p.name).join(', ') || ''
      const ret = node.returnType
        ? ` : ${typeToString(node.returnType)}`
        : ''
      return `方法 ${methodDefName(node.name)}(${params})${ret}`
    }
    if (isMethodBind(node)) {
      return `绑定 ${node.name}`
    }
    if (isLambdaDef(node)) {
      // 同像：lambda 的类型就是 { apply(...) }，直接展示签名
      const t = this.checker.inferType(node)
      if (t.kind === 'object') {
        const sig = t.methods.get('apply')?.[0]
        if (sig) {
          const params = (sig.params ?? [])
            .map((p) => (p ? describeType(p) : 'any'))
            .join(', ')
          return `λ(${params}) => ${describeType(sig.returns)}`
        }
      }
      return 'λ'
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
 * 从 MethodDefName 取出方法名：Ref/StID/Str 三种形态。
 */
function methodDefName(name: {
  name: { $type: string; value: string }
}): string {
  const v = name.name
  if (isRef(v)) {
    return v.value
  }
  if (isStID(v)) {
    return v.value.slice(1)
  }
  return v.value
}

/**
 * 对象的悬停展示：列出方法签名，方便在编辑器里查看对象形状。
 * 返回 markdown：方法签名用 `- ` 列表，否则单行换行会被 markdown 折叠成空格。
 */
function describeHoverType(t: TypeInfo): string {
  if (t.kind === 'union') {
    const branches = t.types.map(describeHoverType).join('\n')
    return `联合类型\n${branches}`
  }
  if (t.kind === 'object') {
    const head = t.name
      ? `类型 ${t.name}${t.parent ? ` (extends ${t.parent})` : ''}`
      : `对象${t.parent ? ` (extends ${t.parent})` : ''}`
    const lines = [...t.methods.entries()].flatMap(([name, sigs]) =>
      sigs.map((sig) => {
        const params = (sig.params ?? [])
          .map((p) => (p ? describeType(p) : 'any'))
          .join(', ')
        const rest = sig.rest ? `, ...${describeType(sig.rest)}` : ''
        return `${name}(${params}${rest}) => ${describeType(sig.returns)}`
      }),
    )
    return lines.length
      ? `${head}\n${lines.map((l) => `- ${l}`).join('\n')}`
      : head
  }
  return describeType(t)
}
