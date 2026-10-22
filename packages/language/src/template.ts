// 字符串模版的文本/洞切分与转义还原。纯函数，供词法（token-builder.ts）、graft 与测试共用。
// 传进来的是 STRING token 的原文（含首尾单引号），如 'a${x}b'；Langium 无 lexer mode，
// 词法层不切分「文本 vs 代码」，但**边界在哪**必须由词法层算准——所以同一个扫描器
// （scanQuotedString / scanHole）既决定 token 到哪收尾，也决定洞内代码从哪到哪。

/** 模版片段：文本段（已还原转义）或洞（源码，待子解析）。 */
export type TemplateSegment =
  | { kind: 'text'; text: string }
  // start：洞源码在 body（去引号）里的起点；供 graft 登记，LSP 换算文档坐标
  | { kind: 'hole'; source: string; start: number }

/** 转义字符还原，复刻 Langium ValueConverter.convertEscapeCharacter。 */
function unescapeChar(char: string): string {
  switch (char) {
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    case 'v':
      return '\v'
    case '0':
      return '\0'
    default:
      return char
  }
}

/**
 * 扫描一段单引号字符串（`start` 指向开引号），返回收尾引号**之后**的下标；未闭合返回 -1。
 *
 * 这是词法与模版切分共用的唯一一条边界规则：`${…}` 洞内可以再写单引号字符串
 * （`'… ${x '' 'y'}'`），洞里的花括号、`//` 注释、`"…"` 都不参与外层配对。
 * 正则做不到这种深度感知，所以 STRING 用的是自定义 token matcher（见 token-builder.ts）。
 */
export function scanQuotedString(text: string, start: number): number {
  if (text[start] !== "'") {
    return -1
  }
  let i = start + 1
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === "'") {
      return i + 1
    }
    if (c === '$' && text[i + 1] === '{') {
      const end = scanHole(text, i + 2)
      if (end < 0) {
        return -1
      }
      i = end
      continue
    }
    i++
  }
  return -1
}

/** 扫描一个模版洞（`start` 指向 `${` 之后），返回配对 `}` **之后**的下标；未闭合返回 -1。 */
export function scanHole(text: string, start: number): number {
  let depth = 1
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === "'") {
      const end = scanQuotedString(text, i)
      if (end < 0) {
        return -1
      }
      i = end
      continue
    }
    if (c === '"') {
      // STID：`"…` 一直延伸到空白
      i++
      while (i < text.length && !/\s/.test(text[i])) {
        i++
      }
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      // 行注释里的引号/花括号不算数
      const nl = text.indexOf('\n', i)
      i = nl < 0 ? text.length : nl + 1
      continue
    }
    if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) {
        return i + 1
      }
    }
    i++
  }
  return -1
}

/** 把整段字符串原文切成文本段/洞段（去掉首尾单引号，还原文本转义）。 */
export function splitTemplate(raw: string): TemplateSegment[] {
  const body =
    raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw
  const out: TemplateSegment[] = []
  let text = ''
  const flush = () => {
    out.push({ kind: 'text', text })
    text = ''
  }
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      text += unescapeChar(body[i + 1] ?? '')
      i += 2
      continue
    }
    if (c === '$' && body[i + 1] === '{') {
      flush()
      // scanHole 返回 `}` 之后的位置；未闭合时把剩余部分整段当洞（由子解析报错）
      const end = scanHole(body, i + 2)
      const stop = end < 0 ? body.length : end - 1
      out.push({ kind: 'hole', source: body.slice(i + 2, stop), start: i + 2 })
      i = end < 0 ? body.length : end
      continue
    }
    text += c
    i++
  }
  flush()
  return out
}

/** 洞求值结果的字符串化：nil/undefined 视作空串（与编译产物 join('') 语义一致）。 */
export function templateStringify(value: unknown): string {
  return value == null ? '' : String(value)
}
