/**
 * 极轻量 OOC 语法高亮：只镜像 grammar 里的 lexer 规则（注释/字符串/数字/关键字），
 * 不给文本着色引擎增加负担，配合 textarea 覆盖层实现"看着高亮、输着纯文本"。
 */
export type TokenType = 'comment' | 'string' | 'number' | 'keyword' | 'ident' | 'plain'

export interface Token {
  type: TokenType
  start: number
  end: number
}

const KEYWORDS = new Set([
  'nil', 'true', 'false', '#guard', '#import', '#type',
])

/** 镜像 Grammars 的 lexer 顺序：注释 → 字符串 → 标识符 → 数字 → 其他 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = source.length

  const isIdentStart = (c: string) => /[_a-zA-Z]/.test(c)
  const isIdentPart = (c: string) => /[_a-zA-Z0-9]/.test(c)

  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]

    // 单行注释 //
    if (ch === '/' && next === '/') {
      let j = i + 2
      while (j < n && source[j] !== '\n') j++
      tokens.push({ type: 'comment', start: i, end: j })
      i = j
      continue
    }
    // 多行注释 /* */
    if (ch === '/' && next === '*') {
      let j = i + 2
      while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++
      const end = Math.min(n, j + 2)
      tokens.push({ type: 'comment', start: i, end })
      i = end
      continue
    }
    // 字符串 '...'
    if (ch === "'") {
      let j = i + 1
      let escaped = false
      while (j < n) {
        const c = source[j]
        if (escaped) {
          escaped = false
          j++
          continue
        }
        if (c === '\\') {
          escaped = true
          j++
          continue
        }
        if (c === "'") {
          j++
          break
        }
        j++
      }
      tokens.push({ type: 'string', start: i, end: j })
      i = j
      continue
    }
    // # 指令
    if (ch === '#') {
      let j = i + 1
      while (j < n && isIdentPart(source[j])) j++
      const word = source.slice(i, j)
      tokens.push({ type: KEYWORDS.has(word) ? 'keyword' : 'ident', start: i, end: j })
      i = j
      continue
    }
    // 标识符 / 关键字
    if (isIdentStart(ch)) {
      let j = i + 1
      while (j < n && isIdentPart(source[j])) j++
      const word = source.slice(i, j)
      tokens.push({
        type: KEYWORDS.has(word) ? 'keyword' : 'ident',
        start: i,
        end: j,
      })
      i = j
      continue
    }
    // 数字
    if (/[0-9]/.test(ch)) {
      let j = i + 1
      while (j < n && /[0-9.]/.test(source[j])) j++
      tokens.push({ type: 'number', start: i, end: j })
      i = j
      continue
    }
    // 其余符号：不换行则吞一个字符
    if (ch !== '\n' && /\s/.test(ch)) {
      i++
      continue
    }
    tokens.push({ type: 'plain', start: i, end: i + 1 })
    i++
  }
  return tokens
}

/** 把 token 流渲染成 HTML（用于高亮层），转义所有原字符串 */
export function renderTokens(source: string, tokens: Token[]): string {
  let html = ''
  let last = 0
  for (const t of tokens) {
    if (t.start > last) html += escapeHtml(source.slice(last, t.start))
    html += `<span class="hl-${t.type}">${escapeHtml(source.slice(t.start, t.end))}</span>`
    last = t.end
  }
  if (last < source.length) html += escapeHtml(source.slice(last))
  return html
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}