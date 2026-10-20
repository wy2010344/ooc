// 字符串模版的文本/洞切分与转义还原。纯函数，供 graft 与（未来的）再生成/测试共用。
// 传进来的是 STRING token 的原文（含首尾单引号），如 'a${x}b'；Langium 无 lexer mode，
// 词法层无法切分「文本 vs 代码」，故整段交给一个 token，此处再做结构化切分。

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

/** 跳过一段字符串字面量（含其引号），返回结束引号的下一个下标。 */
function skipString(body: string, start: number, quote: string): number {
  let i = start + 1
  while (i < body.length) {
    const c = body[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === quote) {
      return i + 1
    }
    i++
  }
  return body.length
}

/** 从洞起点扫描到配对的 '}'（跳过字符串/嵌套模版/嵌套花括号），返回 '}' 的下标。 */
function findHoleEnd(body: string, start: number): number {
  let depth = 1
  let i = start
  while (i < body.length) {
    const c = body[i]
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(body, i, c)
      continue
    }
    if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) {
        return i
      }
    }
    i++
  }
  return body.length
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
      const end = findHoleEnd(body, i + 2)
      out.push({ kind: 'hole', source: body.slice(i + 2, end), start: i + 2 })
      i = end + 1
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
