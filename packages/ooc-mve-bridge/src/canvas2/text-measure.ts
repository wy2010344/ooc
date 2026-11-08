// 文本测量的宿主能力（对标 canvasCore/Paragraph 的 buildParagraph）。
//
// TS 侧用 CanvasKit 的 Paragraph 排版；ooc 桥接跑在普通 Canvas2D 上，
// 这里用 measureText + 贪心换行给出同形的 { lines, width }：
//   - 自动换行（给有限 maxWidth）；
//   - 无限宽（autoWidth / noWrap，maxWidth 足够大时）只按 '\n' 硬换行；
//   - maxLines + ellipsis 截断；
//   - 单行墨迹补偿需要 tight ink（measureTextInk）。
// 只读 Canvas2D 上下文，不触碰任何 OOC 对象成员。

let measureCtx: CanvasRenderingContext2D | null = null

/** 惰性建一个离屏 2D 上下文，专门用于测量（不参与绘制） */
function ctxOf(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D')
    measureCtx = ctx
  }
  return measureCtx
}

interface TextStyleInput {
  ctx2: CanvasRenderingContext2D
  font: string
  letterSpacing?: number
  wordSpacing?: number
}

interface MeasureInput {
  font: string
  text: string
  letterSpacing?: number
  wordSpacing?: number
}

/** 把字体 / 字距 / 词距写进上下文（letterSpacing 等新属性在旧浏览器上静默跳过） */
export function applyTextStyle({ ctx2, font, letterSpacing, wordSpacing }: TextStyleInput) {
  ctx2.font = font
  const c = ctx2 as unknown as Record<string, unknown>
  if ('letterSpacing' in c) c.letterSpacing = `${letterSpacing || 0}px`
  if ('wordSpacing' in c) c.wordSpacing = `${wordSpacing || 0}px`
}

/** 单行文本宽度（含字距 / 词距） */
export function measureTextWidth({
  font,
  text,
  letterSpacing = 0,
  wordSpacing = 0,
}: MeasureInput): number {
  const ctx2 = ctxOf()
  applyTextStyle({ ctx2, font, letterSpacing, wordSpacing })
  return ctx2.measureText(text ?? '').width
}

/**
 * 单行墨迹在「middle 基线」下的上 / 下延展。
 * 绘制用 textBaseline='middle'，因此返回的 ascent 向上、descent 向下，
 * 光学补偿就是 (ascent - descent) / 2（把墨迹盒中心对到行盒中心）。
 */
export function measureTextInk({
  font,
  text,
  letterSpacing = 0,
  wordSpacing = 0,
}: MeasureInput) {
  const ctx2 = ctxOf()
  applyTextStyle({ ctx2, font, letterSpacing, wordSpacing })
  ctx2.textBaseline = 'middle'
  const m = ctx2.measureText(text ?? '')
  return {
    ascent: m.actualBoundingBoxAscent ?? 0,
    descent: m.actualBoundingBoxDescent ?? 0,
  }
}

/** 按字符硬切（超长单词 / CJK 无空格串的兜底） */
function splitByChar({
  token,
  limit,
  font,
  letterSpacing,
  wordSpacing,
}: {
  token: string
  limit: number
  font: string
  letterSpacing: number
  wordSpacing: number
}): string[] {
  const out: string[] = []
  let buf = ''
  for (const ch of token) {
    if (
      buf !== '' &&
      measureTextWidth({ font, text: buf + ch, letterSpacing, wordSpacing }) > limit
    ) {
      out.push(buf)
      buf = ch
    } else {
      buf += ch
    }
  }
  if (buf !== '') out.push(buf)
  return out
}

/** 截断并补省略号（宽度容不下时逐字回退） */
function withEllipsis({
  line,
  limit,
  ellipsis,
  font,
  letterSpacing,
  wordSpacing,
}: {
  line: string
  limit: number
  ellipsis: string
  font: string
  letterSpacing: number
  wordSpacing: number
}): string {
  const fits = (s: string) =>
    measureTextWidth({ font, text: s + ellipsis, letterSpacing, wordSpacing }) <= limit
  if (fits(line)) return line + ellipsis
  let keep = line
  while (keep.length > 0 && !fits(keep)) {
    keep = keep.slice(0, keep.length - 1)
  }
  return keep + ellipsis
}

interface WrapTextInput {
  font: string
  text: string
  maxWidth: number
  maxLines: number
  ellipsis: string
  letterSpacing?: number
  wordSpacing?: number
}

/**
 * 排版文本：返回 { lines, width }。
 * - maxWidth <= 0 或 >= 极大值（调用方用 MAX_WIDTH 表达 autoWidth / noWrap）时不软换行；
 * - maxLines <= 0 或 >= 极大值时不截断；
 * - 行宽取所有行的最大值。
 */
export function wrapText({
  font,
  text,
  maxWidth,
  maxLines,
  ellipsis,
  letterSpacing = 0,
  wordSpacing = 0,
}: WrapTextInput) {
  const src = text ?? ''
  if (src.length === 0) return { lines: [] as string[], width: 0 }
  const soft = maxWidth > 0 && maxWidth < 1e9
  const out: string[] = []
  for (const chunk of src.split('\n')) {
    if (!soft || chunk === '') {
      out.push(chunk)
      continue
    }
    const tokens = chunk.match(/[^\s]+|\s+/g) ?? [chunk]
    let cur = ''
    for (const token of tokens) {
      if (cur === '') {
        if (measureTextWidth({ font, text: token, letterSpacing, wordSpacing }) <= maxWidth) {
          cur = token
        } else {
          const pieces = splitByChar({ token, limit: maxWidth, font, letterSpacing, wordSpacing })
          for (let i = 0; i < pieces.length - 1; i++) out.push(pieces[i])
          cur = pieces[pieces.length - 1] ?? ''
        }
      } else if (
        measureTextWidth({ font, text: cur + token, letterSpacing, wordSpacing }) <= maxWidth
      ) {
        cur += token
      } else {
        out.push(cur.replace(/\s+$/, ''))
        if (token.trim() === '') {
          cur = ''
        } else if (
          measureTextWidth({ font, text: token, letterSpacing, wordSpacing }) <= maxWidth
        ) {
          cur = token
        } else {
          const pieces = splitByChar({ token, limit: maxWidth, font, letterSpacing, wordSpacing })
          for (let i = 0; i < pieces.length - 1; i++) out.push(pieces[i])
          cur = pieces[pieces.length - 1] ?? ''
        }
      }
    }
    if (cur !== '') out.push(cur)
  }
  let lines = out
  if (maxLines > 0 && maxLines < 1e9 && lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    lines[maxLines - 1] = withEllipsis({
      line: lines[maxLines - 1],
      limit: maxWidth,
      ellipsis: ellipsis || '\u2026',
      font,
      letterSpacing,
      wordSpacing,
    })
  }
  let width = 0
  for (const line of lines) {
    width = Math.max(width, measureTextWidth({ font, text: line, letterSpacing, wordSpacing }))
  }
  return { lines, width }
}
