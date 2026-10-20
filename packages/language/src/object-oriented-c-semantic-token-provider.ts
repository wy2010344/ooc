import { AstNode } from 'langium'
import { AbstractSemanticTokenProvider, SemanticTokenAcceptor } from 'langium/lsp'
import {
  isAssignment,
  isBool,
  isImportStatement,
  isMessage,
  isMessageInfixRight,
  isMethod,
  isNamedExpression,
  isNil,
  isNum,
  isParam,
  isRef,
  isStID,
  isTypeDef,
  isTypeName,
} from './generated/ast.js'
import { holeNodeRange } from './template-offsets.js'
import { SemanticTokenTypes } from 'vscode-languageserver-protocol'

export class ObjectOrientedCSemanticTokenProvider extends AbstractSemanticTokenProvider {
  protected override highlightElement(
    node: AstNode,
    acceptor: SemanticTokenAcceptor,
  ): void | undefined | 'prune' {
    // 模版洞 ${…} 内的节点是子解析出的独立 CST（offset 相对洞源码），
    // 直接用它的 range 会错位到文档 line 0；映射回文档坐标再接受
    const holeRange = holeNodeRange(node, this.currentDocument)
    if (holeRange) {
      const holeType = this.holeTokenType(node)
      if (holeType) {
        acceptor({ range: holeRange, type: holeType })
      }
      return undefined
    }
    if (isMessage(node) || isMethod(node)) {
      acceptor({ node, property: 'name', type: SemanticTokenTypes.method })
    } else if (isStID(node)) {
      acceptor({ node, property: 'value', type: SemanticTokenTypes.string })
    } else if (isRef(node)) {
      acceptor({ node, property: 'value', type: SemanticTokenTypes.variable })
    } else if (isImportStatement(node) || isAssignment(node) || isParam(node)) {
      acceptor({ node, property: 'name', type: SemanticTokenTypes.variable })
    } else if (isNamedExpression(node)) {
      acceptor({ node, property: 'param', type: SemanticTokenTypes.variable })
    } else if (isBool(node) || isNil(node)) {
      acceptor({ node, property: 'value', type: SemanticTokenTypes.macro })
    } else if (isNum(node)) {
      acceptor({ node, property: 'value', type: SemanticTokenTypes.number })
    } else if (isTypeName(node) || isTypeDef(node)) {
      acceptor({ node, property: 'name', type: SemanticTokenTypes.type })
    } else if (isMessageInfixRight(node)) {
      acceptor({ node, property: 'infix', type: SemanticTokenTypes.operator })
    }
    return undefined
  }

  /** 洞内节点的 token 类型（property 形式拿不到 CST，只判断类型）。 */
  private holeTokenType(node: AstNode): string | undefined {
    if (isMessage(node) || isMethod(node)) return SemanticTokenTypes.method
    if (isStID(node)) return SemanticTokenTypes.string
    if (isRef(node)) return SemanticTokenTypes.variable
    if (isAssignment(node) || isParam(node) || isNamedExpression(node)) {
      return SemanticTokenTypes.variable
    }
    if (isBool(node) || isNil(node)) return SemanticTokenTypes.macro
    if (isNum(node)) return SemanticTokenTypes.number
    if (isTypeName(node) || isTypeDef(node)) return SemanticTokenTypes.type
    if (isMessageInfixRight(node)) return SemanticTokenTypes.operator
    return undefined
  }
}
