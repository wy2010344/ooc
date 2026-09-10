/**
 * CodeMirror 6 封装：替掉原来自研的 textarea+高亮覆盖层。
 * 滚动/光标/IME 由 CM6 自带的 contenteditable 引擎处理，高亮与 lint 走 langium
 * 工具链（见 src/lib/ooc-editor.ts），不再需要手工同步滚动位置。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Annotation, EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  placeholder,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { Engine } from '../lib/engine.js'
import {
  langiumHighlightExtension,
  langiumLintExtension,
} from '../lib/ooc-editor.js'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** 聚焦状态变化（用于在移动键盘上方显示快捷键） */
  onFocusChange?: (focused: boolean) => void
  /** 引擎（lint 复用其 typeCheck，与运行同一套 langium 校验） */
  engine: Engine
  /** 当前笔记名（lint 用的文档名，供 #import 相对解析） */
  noteName: string
}

export interface CodeAreaHandle {
  /** 在光标处插入文本（移动端快捷键用），替换选中区域 */
  insert: (text: string) => void
  focus: () => void
}

/** 外部同步（切换笔记等）发起的变更，不该再触发 onChange 落盘 */
const externalUpdate = Annotation.define<boolean>()

/** 复用 index.css 的 hl-* 配色，编辑器本体透明融入页面背景 */
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '15px',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.6',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    padding: '1rem 1rem',
    caretColor: '#059669',
    minHeight: '100%',
  },
  '.cm-line': {
    padding: '0',
    fontFamily: 'inherit',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor': {
    borderLeftColor: '#059669',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, currentColor 14%, transparent)',
  },
  '.cm-placeholder': {
    color: 'color-mix(in oklab, currentColor 45%, transparent)',
  },
})

export const CodeArea = forwardRef<CodeAreaHandle, Props>(function CodeArea(
  { value, onChange, placeholder: hint, onFocusChange, engine, noteName },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 用 ref 拿最新回调，避免 CM6 扩展在闭包里抓旧 props
  const onChangeRef = useRef(onChange)
  const onFocusChangeRef = useRef(onFocusChange)
  onChangeRef.current = onChange
  onFocusChangeRef.current = onFocusChange

  // 仅首个挂载创建编辑器；noteName 随 note 切换由 Editor 的 key 重建本组件
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view: EditorView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          EditorView.lineWrapping,
          placeholder(hint ?? ''),
          keymap.of([
            // 物理键盘 Tab：插入 4 空格而非切换焦点
            { key: 'Tab', run: (v) => insertAtCaret(v, '    ') },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorState.tabSize.of(4),
          langiumHighlightExtension(),
          langiumLintExtension(engine, noteName),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            const isExternal = u.transactions.some((t) =>
              t.annotation(externalUpdate) === true,
            )
            if (!isExternal) onChangeRef.current(u.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            focus: () => onFocusChangeRef.current?.(true),
            blur: () => onFocusChangeRef.current?.(false),
            pointerdown: () => view.focus(),
          }),
          editorTheme,
        ],
      }),
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 一次性创建；value 由下方 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部值变化（切笔记、回填源码）同步进 CM6，不触发 onChange
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur === value) return
    view.dispatch({
      changes: { from: 0, to: cur.length, insert: value },
      annotations: externalUpdate.of(true),
      selection: { anchor: 0 },
      scrollIntoView: true,
    })
    view.scrollDOM.scrollTop = 0
  }, [value])

  useImperativeHandle(
    ref,
    () => {
      const insert = (text: string) => {
        const view = viewRef.current
        if (!view) return
        view.focus()
        insertAtCaret(view, text)
      }
      return { insert, focus: () => viewRef.current?.focus() }
    },
    [],
  )

  return (
    <div className="h-full w-full font-mono text-stone-900 dark:text-zinc-100">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  )
})

/** 在光标处替换选中区为 text，并把光标挪到插入文本之后 */
function insertAtCaret(view: EditorView, text: string): true {
  const sel = view.state.selection.main
  const changes = { from: sel.from, to: sel.to, insert: text }
  view.dispatch(
    view.state.update({
      changes,
      selection: { anchor: sel.from + text.length },
      scrollIntoView: true,
    }),
  )
  return true
}