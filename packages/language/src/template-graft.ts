// 解析后处理：把每个字符串字面量（Str）在其原文里按 ${表达式} 拆成文本段/洞，洞内
// 表达式用同一 parser 子解析后挂进 AST（parts）。这样下游 codegen/解释器/类型检查/LSP
// 只需读 parts，无需各自再解析——模版字符串作为一等 AST 特性生效。
// 纯字符串（无洞）不填 parts，保持既有 value 语义（含「纯字面量＝数据属性」判定）。
import { AstUtils, type AstNode } from 'langium'
import type {
  Expression,
  Model,
  Str,
  TemplateHole,
  TemplatePart,
  TemplateText,
} from './generated/ast.js'
import { splitTemplate, type TemplateSegment } from './template.js'

/** 子解析器：把洞源码解析成表达式（解析失败/非表达式返回 undefined）。 */
export type HoleParser = (source: string) => Expression | undefined

/** 用文档级 parser 构造洞解析器：洞按单条表达式语句解析，取首个非赋值语句。 */
export function makeHoleParser(parse: (source: string) => unknown): HoleParser {
  return (source) => {
    if (!source.trim()) {
      return undefined
    }
    const result = parse(source) as { value?: Model } | undefined
    const stmt = result?.value?.expressions?.[0]
    if (!stmt || stmt.$type === 'Assignment') {
      return undefined
    }
    return stmt as Expression
  }
}

/** 遍历 root 下所有字符串字面量，含 ${} 洞者填充 parts。 */
export function graftTemplates(root: AstNode, parseHole: HoleParser): void {
  const strings: Str[] = []
  for (const node of AstUtils.streamAst(root)) {
    if (node.$type === 'Str') {
      strings.push(node as Str)
    }
  }
  for (const str of strings) {
    graftOne(str, parseHole)
  }
}

function graftOne(str: Str, parseHole: HoleParser): void {
  // 用 CST 原文切分（能区分 \$ 转义与真洞）；无 CST（手写 AST）时按纯文本处理。
  const raw = str.$cstNode?.text
  const segments: TemplateSegment[] = raw
    ? splitTemplate(raw)
    : [{ kind: 'text', text: str.value }]
  let hasHole = false
  const parts: TemplatePart[] = []
  for (const seg of segments) {
    if (seg.kind === 'text') {
      parts.push(makeText(seg.text, str, parts.length))
      continue
    }
    const expr = parseHole(seg.source)
    if (expr) {
      hasHole = true
      parts.push(makeHole(expr, str, parts.length))
      graftTemplates(expr, parseHole) // 洞内字符串仍可能是模版
    } else {
      parts.push(makeText('', str, parts.length))
    }
  }
  if (hasHole) {
    str.parts = parts
  }
}

function makeText(value: string, parent: Str, index: number): TemplateText {
  const node = { $type: 'TemplateText', value } as unknown as TemplateText
  attach(node, parent, index)
  return node
}

function makeHole(
  expression: Expression,
  parent: Str,
  index: number,
): TemplateHole {
  const node = { $type: 'TemplateHole', expression } as unknown as TemplateHole
  attach(node, parent, index)
  // 洞内表达式根节点的容器指向本 hole（子节点由子解析器内部指向，无需改动），
  // 使 $container 链一路连回 Model，作用域/链接/定位都能正常工作。
  const e = expression as unknown as Record<string, unknown>
  e.$container = node
  e.$containerProperty = 'expression'
  return node
}

function attach(node: AstNode, parent: Str, index: number): void {
  const n = node as unknown as Record<string, unknown>
  n.$container = parent
  n.$containerProperty = 'parts'
  n.$containerIndex = index
}
