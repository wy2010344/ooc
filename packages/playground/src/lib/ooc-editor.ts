/**
 * 用 langium 生成的词法器做 OOC 语法高亮、用 langium 校验器做实时 lint。
 * 替换掉此前手写的 tokenize/renderTokens（自造轮子），编辑器本体换 CodeMirror 6。
 *
 * - 高亮：services.parser.Lexer.tokenize 直接产出的 token（含 hidden 注释），
 *   映射成 CM6 的 Decoration（复用 index.css 里的 hl-* 配色）。
 * - lint：复用 engine.typeCheck.check（与运行/CLI 同一套 Langium 校验器），
 *   把 LSP 的行/列坐标换算成 CM6 的位置。
 */
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import {
  lintGutter,
  linter,
  type Diagnostic as CmDiagnostic,
  type LintSource,
} from '@codemirror/lint'
import { createObjectOrientedCServices } from 'object-oriented-c-language'
import type { Engine } from './engine.js'

/** langium Lexer.tokenize 返回的 token 的最小形状（不直接依赖 langium 类型） */
interface LexToken {
  tokenType: { name: string }
  image: string
  startOffset: number
  /** chevrotain 的 endOffset 指向最后一个字符本身（含），排他终点要 +1 */
  endOffset: number
}

interface LexerLike {
  tokenize(text: string): { tokens: LexToken[]; hidden: LexToken[] }
}

let lexer: LexerLike | null = null

/** 惰性构建共享词法器（只用 parser.Lexer，不触碰工作区/文档） */
function getLexer(): LexerLike {
  if (!lexer) {
    const { ObjectOrientedC } = createObjectOrientedCServices({
      fileSystemProvider: () => ({} as never),
    })
    lexer = ObjectOrientedC.parser.Lexer as unknown as LexerLike
  }
  return lexer
}

/** OOC 关键字/内建值：词法器把 nil、#import 等当作独立 token 类型 */
const KEYWORDS = new Set(['nil', 'true', 'false', 'as', '#import', '#type', '#guard'])

function classifyToken(t: LexToken): string | null {
  const name = t.tokenType.name
  if (name === 'STRING' || name === 'STID') return 'hl-string'
  if (name === 'NUMBER') return 'hl-number'
  if (name === 'BOOL' || KEYWORDS.has(t.image)) return 'hl-keyword'
  return null
}

/** 整篇 tokenize，产出按位置升序的 CM6 高亮装饰（导出供单测直连） */
export function tokenizeToDecorations(text: string, state: EditorState): DecorationSet {
  let result: { tokens: LexToken[]; hidden: LexToken[] }
  try {
    result = getLexer().tokenize(text)
  } catch {
    return Decoration.none
  }
  const marks: Array<Range<Decoration>> = []
  const push = (t: LexToken) => {
    const cls = classifyToken(t)
    if (!cls || t.image.length === 0) return
    const from = t.startOffset
    const to = Math.min(t.endOffset + 1, state.doc.length)
    if (to <= from) return
    marks.push(Decoration.mark({ class: cls }).range(from, to))
  }
  for (const t of result.tokens) push(t)
  for (const t of result.hidden) {
    if (t.image.length === 0) continue
    const from = t.startOffset
    const to = Math.min(t.endOffset + 1, state.doc.length)
    if (to <= from) continue
    marks.push(Decoration.mark({ class: 'hl-comment' }).range(from, to))
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to)
  return Decoration.set(marks)
}

const setDecorationEffect = StateEffect.define<DecorationSet>()

const highlightField = StateField.define<DecorationSet>({
  create(state) {
    return tokenizeToDecorations(state.doc.toString(), state)
  },
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setDecorationEffect)) deco = e.value
    }
    return deco
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** 文档变化后防抖重算高亮（笔记很小，整篇重 tokenize 代价可忽略） */
const highlightPlugin = ViewPlugin.fromClass(
  class HighlightSync {
    private timer = 0
    constructor(readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged) return
      clearTimeout(this.timer)
      const view = this.view
      this.timer = window.setTimeout(() => {
        // 每次触发时当场取最新文档，避免对旧文本画装饰
        const decos = tokenizeToDecorations(view.state.doc.toString(), view.state)
        view.dispatch({ effects: setDecorationEffect.of(decos) })
      }, 40)
    }

    destroy() {
      clearTimeout(this.timer)
    }
  },
)

/** 基于 langium 词法器的 OOC 高亮扩展 */
export function langiumHighlightExtension(): Extension {
  return [highlightField, highlightPlugin]
}

/** LSP 的行/列（0 起）换算成 CM6 位置（UTF-16 码元，与 JS 字符串逐位对应） */
export function lspPosToCm(state: EditorState, line: number, character: number): number {
  const doc = state.doc
  if (line <= 0) return Math.max(character, 0)
  if (line > doc.lines) return doc.length
  // LSP 行号从 0 起，Text.line 从 1 起，接缝 +1
  const l = doc.line(line + 1)
  return Math.min(l.from + Math.max(character, 0), doc.length)
}

/** langium 校验器返回的诊断的最小形状 */
interface LspDiag {
  message: string
  severity?: number
  range?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

function toCmDiagnostic(state: EditorState, d: LspDiag): CmDiagnostic | null {
  const range = d.range
  if (!range || typeof range.start?.line !== 'number') {
    // 没有位置的诊断塞不进编辑区，交给运行后的诊断条展示
    return null
  }
  const from = lspPosToCm(state, range.start.line, range.start.character)
  const end = d.range
    ? lspPosToCm(state, d.range.end.line, d.range.end.character)
    : from
  return {
    from: Math.min(from, end),
    to: Math.max(from, end),
    severity: d.severity === 1 ? 'error' : d.severity === 3 ? 'info' : 'warning',
    message: d.message,
  }
}

/**
 * 实时 lint 的 LintSource：每次编辑后（linter 自带 delay 防抖）跑 typeCheck，
 * 与运行、CLI 走同一条 langium 校验路径。
 */
export function createLintSource(engine: Engine, noteName: string): LintSource {
  let seq = 0
  return async (view) => {
    const my = ++seq
    const text = view.state.doc.toString()
    try {
      const diags = (await engine.typeCheck.check(text, noteName)) as LspDiag[]
      // 只采纳最新一次请求的结果，避免乱序覆盖
      if (my !== seq) return []
      const out: CmDiagnostic[] = []
      for (const d of diags) {
        const cm = toCmDiagnostic(view.state, d)
        if (cm) out.push(cm)
      }
      return out
    } catch (err) {
      if (my !== seq) return []
      return [{ from: 0, to: 0, severity: 'error', message: String(err) }]
    }
  }
}

/** 实时 lint 扩展：波浪线 + 行号槽（原文含波线/图标两种提示） */
export function langiumLintExtension(engine: Engine, noteName: string): Extension {
  return [linter(createLintSource(engine, noteName), { delay: 400 }), lintGutter()]
}