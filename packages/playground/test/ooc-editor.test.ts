// ooc-editor 纯逻辑测试：langium 词法高亮的 token 类别/区间、LSP 行/列→CM6 位置。
// CodeMirror 的 EditorState/Decoration 是纯状态计算，Node 下可直接构造。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { lspPosToCm, tokenizeToDecorations } from '../src/lib/ooc-editor.js'

function spansOf(src: string): Array<{ cls: string; text: string }> {
  const state = EditorState.create({ doc: src })
  const out: Array<{ cls: string; text: string }> = []
  tokenizeToDecorations(src, state).between(0, state.doc.length, (from, to, value) => {
    out.push({ cls: value.spec.class as string, text: src.slice(from, to) })
  })
  return out
}

test('langium 词法器高亮：注释/字符串/数字/关键字分类正确', () => {
  const spans = spansOf("// 注释\nx = 12 \"// 3\nnil true as '#import' #guard \"/ y")
  const by = (cls: string) => spans.filter((s) => s.cls === cls).map((s) => s.text)
  // 注释
  assert.ok(by('hl-comment').includes('// 注释'))
  // STID（双引号内部方法名）与单引号字符串都算字符串
  assert.ok(by('hl-string').includes('"//'))
  assert.ok(by('hl-string').includes('"/'))
  assert.ok(by('hl-string').includes("'#import'"))
  // 数字
  assert.ok(by('hl-number').includes('12'))
  assert.ok(by('hl-number').includes('3'))
  // 关键字：nil / true / as / #guard（BOOL 与 literal token）
  for (const kw of ['nil', 'true', 'as', '#guard']) {
    assert.ok(by('hl-keyword').includes(kw), `期望 ${kw} 着关键字色，实际=${JSON.stringify(by('hl-keyword'))}`)
  }
})

test('langium 词法器高亮：装饰区间与原文逐字节对齐且不重叠', () => {
  const src = "// abc\n12 \"/ 7 // 尾\nnil\n"
  const spans = spansOf(src)
  assert.ok(spans.length > 0)
  // 位置区间必须落在文档内且按序不重叠
  let prevTo = 0
  tokenizeToDecorations(src, EditorState.create({ doc: src })).between(
    0,
    src.length,
    (from, to) => {
      assert.ok(from >= prevTo, `装饰区间重叠：${from} < ${prevTo}`)
      prevTo = to
    },
  )
  // 所有装饰区间都落在文档内（不越界）
  const covered = new Set<boolean>()
  tokenizeToDecorations(src, EditorState.create({ doc: src })).between(0, src.length, (from, to) => {
    covered.add(from >= 0 && to <= src.length && from <= to)
  })
  assert.ok(covered.size === 1 && covered.has(true))
})

test('LSP 行/列 → CM6 位置换算（含越界兜底）', () => {
  const src = "// a\nx = 1\nyy = 2\n"
  const state = EditorState.create({ doc: src })
  // 第一行行内越界 → 行尾
  assert.equal(lspPosToCm(state, 1, 999), src.length)
  // 行超界 → 文档末尾
  assert.equal(lspPosToCm(state, 99, 0), src.length)
  // 正常换算：第二行（LSP 行号 2）起点是 "yy = 2" 的 y
  const line2 = src.split('\n')[2]
  const lineStart = src.indexOf(line2)
  assert.equal(lspPosToCm(state, 2, 1), lineStart + 1)
  // 行号 1 → 第一行
  assert.equal(lspPosToCm(state, 1, 5), src.indexOf('x = 1') + 5)
})