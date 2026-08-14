import { CompletionItem, CompletionItemKind } from 'vscode-languageserver'
import type { AstNode } from 'langium'
import {
  isAssignment,
  isMessage,
  isMessageOrChain,
  isModel,
  isRef,
} from './generated/ast.js'
import { describeType } from './type-system.js'
import { findLastIdentifier } from './completion-type-utils.js'

/**
 * 方法补全逻辑 — 基于上下文推断补全类型
 */

export function getContextualMethodCompletions(
  checker: any,
  node: AstNode | undefined,
  offset: number,
  text: string,
): CompletionItem[] {
  if (!node) return []

  // 场景1: 光标在 Ref 节点上 → 补全该对象的方法
  if (isRef(node)) {
    return getMethodCompletionsFromRef(checker, node)
  }

  // 场景2: 光标在 MessageOrChain 上 → 补全该对象的方法
  if (isMessageOrChain(node)) {
    return getMessageChainCompletions(checker, node)
  }

  // 场景3: 光标在 Message 上 → 补全该对象的方法
  if (isMessage(node)) {
    const container = node.$container
    if (container && isMessageOrChain(container)) {
      return getMessageChainCompletions(checker, container)
    }
  }

  // 场景4: 尾部位置 - 检查光标前是否有 Ref
  const textBefore = text.substring(0, offset).trimEnd()
  if (textBefore.length > 0) {
    const lastIdent = findLastIdentifier(textBefore)
    if (lastIdent) {
      return getMethodCompletionsByName(checker, node, lastIdent)
    }
  }

  return []
}

/**
 * 从 Ref 节点获取方法补全
 */
function getMethodCompletionsFromRef(checker: any, refNode: AstNode): CompletionItem[] {
  const items: CompletionItem[] = []
  const t = checker.inferType(refNode)
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
  return items
}

/**
 * 从 MessageOrChain 节点获取方法补全
 */
function getMessageChainCompletions(checker: any, chainNode: AstNode): CompletionItem[] {
  const items: CompletionItem[] = []
  if (isMessageOrChain(chainNode)) {
    const primary = chainNode.primary
    if (primary) {
      const t = checker.inferType(primary)
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
  }
  return items
}

/**
 * 按名称查找变量并返回其方法
 */
function getMethodCompletionsByName(checker: any, currentNode: AstNode, name: string): CompletionItem[] {
  let cur: AstNode | undefined = currentNode
  while (cur) {
    const varNode = findVariableByName(cur, name)
    if (varNode && isRef(varNode)) {
      return getMethodCompletionsFromRef(checker, varNode)
    }
    cur = cur.$container
  }
  return []
}

/**
 * 在节点中按名称查找变量
 */
function findVariableByName(node: AstNode, name: string): AstNode | undefined {
  if (isModel(node)) {
    for (const stmt of node.expressions) {
      if (isAssignment(stmt) && stmt.name === name) {
        if (stmt.expression && isRef(stmt.expression)) {
          return stmt.expression
        }
        return stmt
      }
    }
  }
  if (isAssignment(node) && node.name === name) {
    if (node.expression && isRef(node.expression)) {
      return node.expression
    }
  }
  return undefined
}
