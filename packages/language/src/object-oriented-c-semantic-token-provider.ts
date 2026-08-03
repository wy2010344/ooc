import { AstNode } from 'langium'
import {
  AbstractSemanticTokenProvider,
  SemanticTokenAcceptor,
} from 'langium/lsp'
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

import { SemanticTokenTypes } from 'vscode-languageserver-protocol'
export class ObjectOrientedCSemanticTokenProvider extends AbstractSemanticTokenProvider {
  protected override highlightElement(
    node: AstNode,
    acceptor: SemanticTokenAcceptor,
  ): void | undefined | 'prune' {
    if (isMessage(node) || isMethod(node)) {
      acceptor({
        node,
        property: 'name',
        type: SemanticTokenTypes.method,
      })
    } else if (isStID(node)) {
      acceptor({
        node,
        property: 'value',
        type: SemanticTokenTypes.string,
      })
    } else if (isRef(node)) {
      acceptor({
        node,
        property: 'value',
        type: SemanticTokenTypes.variable,
      })
    } else if (isImportStatement(node) || isAssignment(node) || isParam(node)) {
      acceptor({
        node,
        property: 'name',
        type: SemanticTokenTypes.variable,
      })
    } else if (isNamedExpression(node)) {
      acceptor({
        node,
        property: 'param',
        type: SemanticTokenTypes.variable,
      })
    } else if (isBool(node) || isNil(node)) {
      acceptor({
        node,
        property: 'value',
        type: SemanticTokenTypes.macro,
      })
    } else if (isNum(node)) {
      acceptor({
        node,
        property: 'value',
        type: SemanticTokenTypes.number,
      })
    } else if (isTypeName(node)) {
      acceptor({
        node,
        property: 'name',
        type: SemanticTokenTypes.type,
      })
    } else if (isTypeDef(node)) {
      acceptor({
        node,
        property: 'name',
        type: SemanticTokenTypes.type,
      })
    } else if (isMessageInfixRight(node)) {
      acceptor({
        node,
        property: 'infix',
        type: SemanticTokenTypes.operator,
      })
    }
  }
}
