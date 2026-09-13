/**
 * CodeMirror 6 封装：替掉原来自研的 textarea+高亮覆盖层。
 * 滚动/光标/IME 由 CM6 自带的 contenteditable 引擎处理，高亮与 lint 走 langium
 * 工具链（见 src/lib/ooc-editor.ts），不再需要手工同步滚动位置。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
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
  /** 只读：默认开，阅读/滚动时键盘不弹；编辑经菜单「解除只读」进入 */
  readOnly: boolean
  /** 代码区是否自动换行（false 时横向滚动） */
  wrap: boolean
}

export interface CodeAreaHandle {
  /** 在光标处插入文本（移动端快捷键用），替换选中区域 */
  insert: (text: string) => void
  /** 成对插入 open+close，并把光标停在开括号之后（[] () {} 合成键用） */
  insertPair: (open: string, close: string) => void
  /** 反向缩进：光标所在行去掉最多 4 个前导空格（⇧+Tab，移动端无硬件 Shift 时用） */
  outdent: () => void
  focus: () => void
}

/** 外部同步（切换笔记等）发起的变更，不该再触发 onChange 落盘 */
const externalUpdate = Annotation.define<boolean>()

/** 只读/自动换行走 Compartment，切换时 reconfigure 而非重建编辑器 */
const readOnlyComp = new Compartment()
const wrapComp = new Compartment()

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
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: 'color-mix(in oklab, currentColor 35%, transparent)',
    fontSize: '12px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklab, currentColor 8%, transparent)',
    color: 'currentColor',
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
  {
    value,
    onChange,
    placeholder: hint,
    onFocusChange,
    engine,
    noteName,
    readOnly,
    wrap,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 用 ref 拿最新回调，避免 CM6 扩展在闭包里抓旧 props
  const onChangeRef = useRef(onChange)
  const onFocusChangeRef = useRef(onFocusChange)
  const readOnlyRef = useRef(readOnly)
  onChangeRef.current = onChange
  onFocusChangeRef.current = onFocusChange
  readOnlyRef.current = readOnly

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
          readOnlyComp.of(EditorState.readOnly.of(readOnlyRef.current)),
          wrapComp.of(EditorView.lineWrapping),
          lineNumbers(),
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
          // 只读时点击正文仅浏览滚动，不聚焦、不弹软键盘；
          // 编辑要经菜单「解除只读」（readOnly 变 false 后此处不再拦截，正常聚焦）
          EditorView.domEventHandlers({
            pointerdown: (e) => {
              if (readOnlyRef.current) e.preventDefault()
            },
            blur: () => onFocusChangeRef.current?.(false),
            focus: () => onFocusChangeRef.current?.(true),
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

  // 只读/换行开关：reconfigure Compartment
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyComp.reconfigure(EditorState.readOnly.of(readOnly)),
    })
  }, [readOnly])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapComp.reconfigure(wrap ? EditorView.lineWrapping : []),
    })
  }, [wrap])

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
      const insertPair = (open: string, close: string) => {
        const view = viewRef.current
        if (!view) return
        view.focus()
        const sel = view.state.selection.main
        view.dispatch(
          view.state.update({
            changes: { from: sel.from, to: sel.to, insert: open + close },
            // 光标停在开括号之后，方便直接往里打字
            selection: { anchor: sel.from + open.length },
            scrollIntoView: true,
          }),
        )
      }
      const outdent = () => {
        const view = viewRef.current
        if (!view) return
        view.focus()
        const sel = view.state.selection.main
        const line = view.state.doc.lineAt(sel.from)
        const m = /^ {1,4}/.exec(line.text)
        if (!m) return
        view.dispatch({
          changes: { from: line.from, to: line.from + m[0].length, insert: '' },
        })
      }
      return { insert, insertPair, outdent, focus: () => viewRef.current?.focus() }
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