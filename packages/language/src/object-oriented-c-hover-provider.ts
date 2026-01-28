import { AstNode, MaybePromise } from 'langium'
import { AstNodeHoverProvider } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import { isMethodAll, isMethodBind, isAssignment } from './generated/ast.js'

export class ObjectOrientedCHoverProvider extends AstNodeHoverProvider {
  constructor(services: ObjectOrientedCServices) {
    super(services)
  }

  protected override getAstNodeHoverContent(
    node: AstNode,
  ): MaybePromise<string | undefined> {
    if (isMethodAll(node)) {
      const params = node.params?.map((p) => p.name).join(', ') || ''
      return `Method: ${node.name}(${params})`
    }
    if (isMethodBind(node)) {
      return `Method Binding: ${node.name}`
    }
    if (isAssignment(node)) {
      return `Assignment: ${node.name}`
    }
    // 可以添加更多节点类型，如ObjectDef, Message等
    return undefined
  }
}
