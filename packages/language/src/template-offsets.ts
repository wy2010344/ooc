// 模版洞（${…}）的文档坐标映射。
//
// 洞内表达式由 template-graft.ts 用同一 parser 子解析，生成的是**独立 CST 树**：其
// offset/line/char 都相对洞源码本身，不在文档 CST 树里。后果是按文档偏移查 CST 只会
// 命中外层 STRING 叶节点（整段字符串），洞内引用既不高亮、也不 hover、也不跳转；
// 若直接用洞内节点的 range 当文档坐标，token 还会错位到 line 0。
//
// 因此 graft 时登记「洞在字符串 body（去引号）里的起点与源码长度」，这里做双向换算：
//   - leafAtTemplateHole：光标在 STRING token 内 → 定位到洞内精确的叶子 CST
//   - holeDocOffset / holeNodeRange：洞内节点 → 文档绝对偏移 / Range
import { AstUtils, CstUtils } from 'langium'
import type {
  AstNode,
  LeafCstNode,
  LangiumDocument,
} from 'langium'
import { isStr, isTemplateHole, type Str, type TemplateHole } from './generated/ast.js'

/** 洞在字符串 body 里的起点（body = STRING token 去掉首尾引号）与源码长度。 */
export interface TemplateHoleSpan {
  start: number
  length: number
}

/** graft 时登记；WeakMap 跟随 AST 生命周期，文档重建后自然失效。 */
export const templateHoleSpans = new WeakMap<TemplateHole, TemplateHoleSpan>()

/**
 * 光标落在某个 Str（STRING token）内时，若命中 ${} 洞，返回洞内精确的叶子 CST。
 * `cursorOffset` 是该 Str 所在坐标系下的偏移（顶层字符串用文档偏移；嵌套模版时用
 * 外层洞内偏移——各层 CST 自洽，递归按当前层换算即可）。
 */
export function leafAtTemplateHole(
  str: Str,
  cursorOffset: number,
): LeafCstNode | undefined {
  const strCst = str.$cstNode
  if (!strCst || !str.parts?.length) return undefined
  // 洞起点相对 body；body 从开引号后一个字符开始
  const bodyStart = strCst.offset + 1
  for (const part of str.parts) {
    if (!isTemplateHole(part)) continue
    const span = templateHoleSpans.get(part)
    if (!span) continue
    const start = bodyStart + span.start
    if (cursorOffset < start || cursorOffset > start + span.length) continue
    // 换算到洞内坐标系（子解析 CST 的 offset 相对洞源码起点）
    const localOffset = cursorOffset - start
    const exprCst = part.expression?.$cstNode
    const leaf = exprCst
      ? CstUtils.findLeafNodeAtOffset(exprCst, localOffset)
      : undefined
    if (!leaf) return undefined
    // 嵌套模版：命中的叶子若是又一个带洞字符串，继续往里钻
    const inner = leaf.astNode
    if (isStr(inner)) {
      return leafAtTemplateHole(inner, localOffset) ?? leaf
    }
    return leaf
  }
  return undefined
}

/**
 * 洞内节点 CST 起点在文档里的绝对偏移。
 * 不在任何模版洞内（普通文档树节点）时返回 undefined。
 */
export function holeDocOffset(node: AstNode): number | undefined {
  const cst = node.$cstNode
  if (!cst) return undefined
  let offset = cst.offset
  let cursor: AstNode = node
  let inside = false
  for (;;) {
    const hole = AstUtils.getContainerOfType(cursor, isTemplateHole)
    if (!hole) break
    const str = hole.$container
    const span = templateHoleSpans.get(hole)
    if (!span || !str.$cstNode) return undefined
    // 本层 CST 偏移 + 洞在字符串里的绝对起点（body 起点 + 洞在 body 内起点）
    offset += str.$cstNode.offset + 1 + span.start
    inside = true
    cursor = str
  }
  return inside ? offset : undefined
}

/** 洞内节点 → 文档绝对 Range；不在洞内返回 undefined。 */
export function holeNodeRange(
  node: AstNode,
  document: LangiumDocument | undefined,
): { start: { line: number; character: number }; end: { line: number; character: number } } | undefined {
  const cst = node.$cstNode
  const start = holeDocOffset(node)
  if (!cst || start === undefined || !document) return undefined
  return {
    start: document.textDocument.positionAt(start),
    end: document.textDocument.positionAt(start + cst.length),
  }
}
