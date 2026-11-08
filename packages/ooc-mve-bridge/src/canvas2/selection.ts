// 选区的宿主小工具：分词 / 分段边界。
// 逐字符扫描放在 OOC 里又慢又啰嗦，这里只返回 [start, end) 偏移，失败给 null。

const segmenter =
  typeof Intl != 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null

/** 包含 offset 的词边界；空白 / 标点不算词，返回 null（对齐 Selectable2 的兜底） */
export function wordRangeOf(text: string, offset: number): [number, number] | null {
  if (!text) return null
  const pos = Math.min(Math.max(offset, 0), text.length)
  if (segmenter) {
    // 文末光标没有「后一个字符」，退到前一个字符所在的词
    const target = Math.min(pos, Math.max(0, text.length - 1))
    for (const part of segmenter.segment(text)) {
      const start = part.index
      const end = start + part.segment.length
      if (target >= start && target < end) {
        return part.isWordLike ? [start, end] : null
      }
    }
    return null
  }
  // 兜底：按空白切词
  let start = pos
  while (start > 0 && !/\s/.test(text[start - 1])) start--
  let end = pos
  while (end < text.length && !/\s/.test(text[end])) end++
  return end > start ? [start, end] : null
}

/** 包含 offset 的逻辑段落 [start, end)（'\n' 分隔） */
export function paragraphRangeOf(text: string, offset: number): [number, number] | null {
  if (!text) return null
  const pos = Math.min(Math.max(offset, 0), text.length)
  const start = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
  const found = text.indexOf('\n', pos)
  const end = found < 0 ? text.length : found
  return end > start ? [start, end] : null
}
