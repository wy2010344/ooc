// 富文本段落的宿主实现（对标 canvasRender2/editable/paragraph.ts 的 PlatformParagraph）。
// TS 侧用 CanvasKit 的 Paragraph；这里用 Canvas2D 逐字符测量 + 贪心折行，
// 对外提供同一组查询：行盒 / 区间矩形 / 坐标 → 偏移 / 偏移 → 光标矩形。
// 只做「数据 → 数据」，不碰 OOC 对象，也不判断成员是否存在。

import { colorToCSS } from 'mve-dom-helper/canvasRender'
import { applyTextStyle, measureTextWidth } from './text-measure.js'

export interface RichSpanInput {
  text: string
  font: string
  fontSize: number
  color: number
  lineHeight: number
  underline?: boolean
  lineThrough?: boolean
  letterSpacing?: number
  wordSpacing?: number
}

export interface RichCharBox {
  index: number
  line: number
  left: number
  right: number
  width: number
  text: string
  span: RichSpanInput
}

export interface RichLineBox {
  start: number
  end: number
  top: number
  bottom: number
  height: number
  width: number
  chars: RichCharBox[]
}

export interface RichRun {
  text: string
  left: number
  y: number
  font: string
  fontSize: number
  color: number
  underline: boolean
  lineThrough: boolean
  letterSpacing: number
  wordSpacing: number
}

export interface RichParagraph {
  width: number
  height: number
  lines: RichLineBox[]
  runs: RichRun[]
}

export interface BuildRichParagraphInput {
  spans: readonly RichSpanInput[]
  /** 折行宽度；<= 0 或极大值表示不软换行 */
  maxWidth: number
  /** 单行模式（忽略换行符与折行） */
  singleLine: boolean
  /** 空文本时的行高 */
  emptyHeight: number
}

/** 逐 (字体, 字符) 缓存宽度：排版只在文本/宽度变化时重建，缓存跨重建复用 */
const widthCache = new Map<string, number>()

function charWidth(span: RichSpanInput, ch: string): number {
  const ls = span.letterSpacing ?? 0
  const ws = span.wordSpacing ?? 0
  const key = `${span.font}|${ch}|${ls}|${ws}`
  const hit = widthCache.get(key)
  if (hit !== undefined) return hit
  const w = measureTextWidth({ font: span.font, text: ch, letterSpacing: ls, wordSpacing: ws })
  widthCache.set(key, w)
  return w
}

/** 把片段按字符摆进软行：折行点按「下一个字符放不下」判断 */
export function buildRichParagraph(input: BuildRichParagraphInput): RichParagraph {
  const limit = input.singleLine
    ? Infinity
    : input.maxWidth > 0 && input.maxWidth < 1e9
      ? input.maxWidth
      : Infinity
  const lines: Array<{ start: number; end: number; height: number; width: number; chars: RichCharBox[] }> = []
  let current = { start: 0, end: 0, height: 0, width: 0, chars: [] as RichCharBox[] }
  let index = 0

  const finish = (end: number) => {
    current.end = end
    lines.push(current)
  }
  const begin = (start: number) => {
    current = { start, end: start, height: 0, width: 0, chars: [] }
  }

  for (const span of input.spans) {
    const text = span.text ?? ''
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '\r') {
        index++
        continue
      }
      if (ch === '\n') {
        if (!input.singleLine) {
          finish(index)
          index++
          begin(index)
        } else {
          index++
        }
        continue
      }
      const w = charWidth(span, ch)
      if (current.chars.length > 0 && current.width + w > limit) {
        finish(index)
        begin(index)
      }
      const box: RichCharBox = {
        index,
        line: lines.length,
        left: current.width,
        right: current.width + w,
        width: w,
        text: ch,
        span,
      }
      current.chars.push(box)
      current.width += w
      current.height = Math.max(current.height, span.lineHeight)
      index++
    }
  }
  finish(index)

  // 空行也要有行高；随后把行坐标落到纵向位置
  let top = 0
  for (const line of lines) {
    line.height = line.height > 0 ? line.height : input.emptyHeight
    const box: RichLineBox = {
      start: line.start,
      end: line.end,
      top,
      bottom: top + line.height,
      height: line.height,
      width: line.width,
      chars: line.chars,
    }
    ;(line as unknown as RichLineBox).top = box.top
    ;(line as unknown as RichLineBox).bottom = box.bottom
    top += line.height
  }
  const outLines = lines as unknown as RichLineBox[]
  let width = 0
  for (const line of outLines) width = Math.max(width, line.width)

  // 同款样式相邻字符合成一次 fillText（emoji 等宽字符按代码单元逐一测量）
  const runs: RichRun[] = []
  for (const line of outLines) {
    const y = line.top + line.height / 2
    let run: RichRun | null = null
    for (const c of line.chars) {
      const same =
        run != null &&
        run.font === c.span.font &&
        run.color === c.span.color &&
        run.underline === !!c.span.underline &&
        run.lineThrough === !!c.span.lineThrough
      if (!same) {
        run = {
          text: c.text,
          left: c.left,
          y,
          font: c.span.font,
          fontSize: c.span.fontSize,
          color: c.span.color,
          underline: !!c.span.underline,
          lineThrough: !!c.span.lineThrough,
          letterSpacing: c.span.letterSpacing ?? 0,
          wordSpacing: c.span.wordSpacing ?? 0,
        }
        runs.push(run)
      } else {
        run!.text += c.text
      }
    }
  }

  return { width, height: top, lines: outLines, runs }
}

export function paraWidth(p: RichParagraph): number {
  return p.width
}

export function paraHeight(p: RichParagraph): number {
  return p.height
}

export function paraLineCount(p: RichParagraph): number {
  return p.lines.length
}

/** 区间 [start, end) 的矩形：按行合并成 [left, top, right, bottom] */
export function paraRects(
  p: RichParagraph,
  start: number,
  end: number,
): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = []
  if (end <= start) return out
  for (const line of p.lines) {
    let left = Infinity
    let right = -Infinity
    for (const c of line.chars) {
      if (c.index >= start && c.index < end) {
        left = Math.min(left, c.left)
        right = Math.max(right, c.right)
      }
    }
    if (right > left) out.push([left, line.top, right, line.bottom])
  }
  return out
}

/** 光标矩形：优先取后一个字符的左缘，文末退到前一个字符的右缘 */
export function paraCaretRect(
  p: RichParagraph,
  index: number,
): [number, number, number, number] | null {
  for (const line of p.lines) {
    for (const c of line.chars) {
      if (c.index === index) return [c.left, line.top, c.right, line.bottom]
    }
    if (line.start === index && line.chars.length === 0) {
      return [0, line.top, 0, line.bottom]
    }
  }
  const last = p.lines[p.lines.length - 1]
  if (!last) return null
  let right = 0
  let top = last.top
  let bottom = last.bottom
  for (const line of p.lines) {
    for (const c of line.chars) {
      if (c.index === index - 1) {
        right = c.right
        top = line.top
        bottom = line.bottom
      }
    }
  }
  return [right, top, right, bottom]
}

/** 某个软行的行索引（按纵向位置命中，命中不到取最近） */
export function paraLineIndexOf(p: RichParagraph, y: number): number {
  let nearest = 0
  let dist = Infinity
  for (let i = 0; i < p.lines.length; i++) {
    const l = p.lines[i]
    if (y >= l.top && y < l.bottom) return i
    const d = y < l.top ? l.top - y : y - l.bottom
    if (d < dist) {
      dist = d
      nearest = i
    }
  }
  return nearest
}

/** 段落内某点 → 文本偏移（按字符中心二分：简单线性扫描，文本量小） */
export function paraGlyphAt(p: RichParagraph, x: number, y: number): number {
  if (p.lines.length === 0) return 0
  const line = p.lines[paraLineIndexOf(p, y)]
  if (!line) return 0
  for (const c of line.chars) {
    if (x < c.left + c.width / 2) return c.index
  }
  return line.end
}

/** 第 index 条软行、横坐标 x 处的文本偏移（上下移动保持视觉列） */
export function paraOffsetOnLine(
  p: RichParagraph,
  index: number,
  x: number,
): number | null {
  const line = p.lines[Math.min(Math.max(index, 0), p.lines.length - 1)]
  if (!line) return null
  for (const c of line.chars) {
    if (x < c.left + c.width / 2) return c.index
  }
  return line.end
}

/** 第 index 条软行的首 / 尾偏移 */
export function paraLineEdge(p: RichParagraph, index: number) {
  const line = p.lines[Math.min(Math.max(index, 0), p.lines.length - 1)]
  return line ? { start: line.start, end: line.end } : { start: 0, end: 0 }
}

/** 以段落原点 (ox, oy) 绘制全部文字与装饰线 */
export function drawRichParagraph({
  p,
  ctx2,
  ox,
  oy,
}: {
  p: RichParagraph
  ctx2: CanvasRenderingContext2D
  ox: number
  oy: number
}) {
  for (const run of p.runs) {
    applyTextStyle({
      ctx2,
      font: run.font,
      letterSpacing: run.letterSpacing,
      wordSpacing: run.wordSpacing,
    })
    ctx2.fillStyle = colorToCSS(run.color)
    ctx2.textAlign = 'left'
    ctx2.textBaseline = 'middle'
    ctx2.fillText(run.text, ox + run.left, oy + run.y)
    if (run.underline || run.lineThrough) {
      const w = measureTextWidth({
        font: run.font,
        text: run.text,
        letterSpacing: run.letterSpacing,
        wordSpacing: run.wordSpacing,
      })
      const dy = oy + run.y + (run.lineThrough ? run.fontSize * 0.05 : run.fontSize * 0.32)
      ctx2.strokeStyle = colorToCSS(run.color)
      ctx2.lineWidth = 1
      ctx2.beginPath()
      ctx2.moveTo(ox + run.left, dy)
      ctx2.lineTo(ox + run.left + w, dy)
      ctx2.stroke()
    }
  }
}
