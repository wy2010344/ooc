import { AstNode } from 'langium'
import {
  AbstractSemanticTokenProvider,
  SemanticTokenAcceptor,
} from 'langium/lsp'
import {
  isAssignment,
  isBool,
  isExceptionCatch,
  isImportStatement,
  isMessage,
  isMethod,
  isNamedExpression,
  isNil,
  isNum,
  isParam,
  isRef,
  isStID,
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
    } else if (isExceptionCatch(node)) {
      acceptor({
        node,
        property: 'name',
        type: SemanticTokenTypes.variable,
      })
      acceptor({
        node,
        property: 'error',
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
    }
  }
}
