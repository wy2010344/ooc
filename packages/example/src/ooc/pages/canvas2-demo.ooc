// canvas2-demo.ooc — canvas2 节点引擎示例（对齐 canvasRender2 的三步装配）。
// 组件都是 lambda 工厂：直接 #import 后调用，不挂在任何门面对象上。
// 文字统一用 textNode（尺寸由文字自答），不再在 draw 里手写 fillText。

#import { dom, text, fc, bindSignal, rgba, storage } '../bridge.ts';
#import { flex2, grow2 } '../bridge.ts';
#import { rect, stage, textNode, editable } '../../../../ooc-mve-bridge/src/canvas2/index.ooc';

canvas2Ink = rgba $ 24 24 27 255;
canvas2Muted = rgba $ 113 113 122 255;
canvas2Card = rgba $ 255 255 255 255;
canvas2Soft = rgba $ 244 244 245 255;
canvas2Line = rgba $ 228 228 231 255;
canvas2Accent = rgba $ 24 24 27 255;
canvas2OnAccent = rgba $ 250 250 250 255;

Canvas2Demo = fc $ [ctx =>
    count = bindSignal $ 0;
    // ---- 富文本编辑器状态（文本 / 样式段信号；编辑器内部按信号重排） ----
    editorHandleRef = storage ref nil;
    editorText = bindSignal $ 'OOC 富文本编辑器：支持样式段、选区拖选、撤销 / 重做与 IME。';
    // 第二个编辑框：用于演示跨节点（跨组件）选区
    editorText2 = bindSignal $ '在这里向左拖选，可以跨越两个编辑框选中文字。';
    editorSegs = bindSignal $ (Array of
        { start = 0, end = 3, style = { bold = true } }
        { start = 31, end = 34, style = { italic = true, color = (rgba $ 220 38 38 255) } }
    );
    // 光标塌缩时工具栏改的是「待输入样式」，这里回显出来，否则点了看不出状态
    pendingLabel = bindSignal $ '基础';

    // 工具栏按钮：回调写方法带参数，组件内直接按消息调用（不包 lambda）
    // mousedown 阻止默认行为，避免隐藏 textarea 失焦
    toolButton = [op =>
        (dom button {
            type = 'button',
            className = 'h-8 min-w-8 rounded-md border px-2 text-xs font-semibold',
            onMouseDown(e) { e preventDefault },
            onClick(e) {
                h = editorHandleRef get;
                #guard h;
                op act h;
                pendingLabel $ (h styleLabel)
            }
        } (text $ (op label)))
    ];
    (dom section { className = 'space-y-3' }
        (dom div { className = 'flex items-baseline justify-between' }
            (dom h2 { className = 'text-lg font-semibold tracking-tight' } (text $ 'CanvasRender2 节点引擎'))
            (dom span { className = 'text-xs text-muted-foreground' } (text $ '移植到 OOC：节点只发消息'))
        )
        (stage $ {
            id = 'canvas2-demo-stage',
            className = 'block h-[360px] w-full rounded-xl border bg-card',
            layout = (flex2 $ { direction = 'y', gap = 12, alignItem = 'stretch', alignFix = true })
        }
            (rect $ {
                radius = 12,
                paddingBlock = 16,
                paddingInline = 16,
                background = canvas2Card,
                borderColor = canvas2Line,
                borderWidth = 1,
                layout = (flex2 $ { direction = 'y', gap = 4, alignItem = 'stretch', alignFix = true })
            }
                (textNode $ {
                    text = 'canvasRender2',
                    fontSize = 20,
                    fontWeight = 700,
                    color = canvas2Ink,
                    autoWidth = true
                })
                (textNode $ {
                    text = '节点只回答消息；缺省行为由 merge 兜底',
                    fontSize = 12,
                    fontWeight = 400,
                    color = canvas2Muted,
                    autoWidth = true
                })
            )
            (rect $ {
                height = 56,
                paddingBlockStart = 10,
                paddingBlockEnd = 10,
                paddingInlineStart = 10,
                paddingInlineEnd = 10,
                radius = 10,
                background = canvas2Soft,
                borderColor = canvas2Line,
                borderWidth = 1,
                layout = (flex2 $ { direction = 'x', gap = 8, alignItem = 'center', alignFix = true })
            }
                (rect $ {
                    width = 120,
                    height = 36,
                    radius = 8,
                    background = canvas2Accent,
                    borderColor = canvas2Accent,
                    borderWidth = 1,
                    layout = (flex2 $ { direction = 'x', alignItem = 'center', directionJustify = 'center' }),
                    mouseClick(e) { count $ ((count $) + 1) }
                }
                    (textNode $ {
                        text = '点击 +1',
                        fontSize = 13,
                        fontWeight = 600,
                        color = canvas2OnAccent,
                        autoWidth = true
                    })
                )
                (rect $ {
                    height = 36,
                    exts = (Array of (grow2 $ { argGrow = 1 })),
                    layout = (flex2 $ { direction = 'x', alignItem = 'center', alignFix = true })
                }
                    (textNode $ {
                        text { '计数：${count $}' },
                        fontSize = 13,
                        fontWeight = 600,
                        color = canvas2Ink,
                        autoWidth = true
                    })
                )
                (rect $ {
                    width = 80,
                    height = 36,
                    radius = 8,
                    background = canvas2Card,
                    borderColor = canvas2Line,
                    borderWidth = 1,
                    layout = (flex2 $ { direction = 'x', alignItem = 'center', directionJustify = 'center' }),
                    mouseClick(e) { count $ 0 }
                }
                    (textNode $ {
                        text = '重置',
                        fontSize = 13,
                        fontWeight = 600,
                        color = canvas2Ink,
                        autoWidth = true
                    })
                )
            )
            (rect $ {
                paddingBlock = 12,
                paddingInline = 12,
                radius = 10,
                background = canvas2Card,
                borderColor = canvas2Line,
                borderWidth = 1,
                layout = (flex2 $ { direction = 'y', gap = 6, alignItem = 'stretch', alignFix = true })
            }
                (rect $ {
                    height = 32,
                    radius = 7,
                    paddingInlineStart = 10,
                    background = canvas2Soft,
                    borderColor = canvas2Line,
                    borderWidth = 1,
                    layout = (flex2 $ { direction = 'x', alignItem = 'center', alignFix = true })
                }
                    (textNode $ {
                        text = '01 · 节点是普通对象，结构消息自己实现',
                        fontSize = 12,
                        fontWeight = 400,
                        color = canvas2Muted,
                        autoWidth = true
                    })
                )
                (rect $ {
                    height = 32,
                    radius = 7,
                    paddingInlineStart = 10,
                    background = canvas2Soft,
                    borderColor = canvas2Line,
                    borderWidth = 1,
                    layout = (flex2 $ { direction = 'x', alignItem = 'center', alignFix = true })
                }
                    (textNode $ {
                        text = '02 · 参数消息转发到 strategy = merge $ props defaults',
                        fontSize = 12,
                        fontWeight = 400,
                        color = canvas2Muted,
                        autoWidth = true
                    })
                )
                (rect $ {
                    height = 32,
                    radius = 7,
                    paddingInlineStart = 10,
                    background = canvas2Soft,
                    borderColor = canvas2Line,
                    borderWidth = 1,
                    layout = (flex2 $ { direction = 'x', alignItem = 'center', alignFix = true })
                }
                    (textNode $ {
                        text = '03 · 布局 / 命中 / 派发复用 canvasRender2 的纯消息实现',
                        fontSize = 12,
                        fontWeight = 400,
                        color = canvas2Muted,
                        autoWidth = true
                    })
                )
            )
        )
        (dom p { className = 'text-xs tabular-nums text-muted-foreground' }
            // DOM 文案要跟着信号走：text 接受 getter，直接传字符串会在构建期冻结
            (text $ [ '当前计数：${count $}' ])
        )
        // ---- 富文本编辑器（B / I / U / 删除线 / 颜色 / 撤销重做） ----
        (dom div { className = 'flex flex-wrap items-center gap-2' }
            (toolButton $ { label = 'B', act(h) { h toggleBold } })
            (toolButton $ { label = 'I', act(h) { h toggleItalic } })
            (toolButton $ { label = 'U', act(h) { h toggleUnderline } })
            (toolButton $ { label = 'S', act(h) { h toggleLineThrough } })
            (toolButton $ { label = '红', act(h) { h setColor (rgba $ 220 38 38 255) } })
            (toolButton $ { label = '黑', act(h) { h setColor canvas2Ink } })
            (toolButton $ { label = '撤销', act(h) { h undo } })
            (toolButton $ { label = '重做', act(h) { h redo } })
        )
        (stage $ {
            id = 'canvas2-editor-stage',
            className = 'block h-[300px] w-full rounded-xl border bg-card',
            layout = (flex2 $ { direction = 'y', gap = 0, alignItem = 'stretch', alignFix = true })
        }
            (rect $ {
                height = 260,
                paddingBlock = 16,
                paddingInline = 16,
                radius = 12,
                background = canvas2Card,
                borderColor = canvas2Line,
                borderWidth = 1,
                layout = (flex2 $ { direction = 'y', gap = 0, alignItem = 'stretch', alignFix = true })
            }
                (editable $ {
                    text { editorText $ },
                    segments { editorSegs $ },
                    onTextChange(v) { editorText $ v },
                    onSegmentsChange(list) { editorSegs $ list },
                    setHandle(h) { editorHandleRef set h },
                    fontSize = 15,
                    lineHeightMultiplier = 1.7,
                    letterSpacing = 0.2,
                    color = canvas2Ink,
                    caretColor = canvas2Accent,
                    selectionColor = (rgba $ 24 24 27 46),
                    placeholder = '在这里输入…（Ctrl+B / I / U 可直接试样式）'
                })
                (editable $ {
                    text { editorText2 $ },
                    onTextChange(v) { editorText2 $ v },
                    fontSize = 15,
                    lineHeightMultiplier = 1.7,
                    letterSpacing = 0.2,
                    color = canvas2Ink,
                    caretColor = canvas2Accent,
                    selectionColor = (rgba $ 24 24 27 46),
                    placeholder = '第二个编辑框：从上面拖选到这里，试试跨组件选区'
                })
            )
        )
        (dom p { className = 'text-xs tabular-nums text-muted-foreground' }
            (text $ [ '文本 ${(editorText $) length} 字 · 样式段 ${(editorSegs $) length} 段 · 待输入样式：${pendingLabel $}' ])
        )
    ) $ ctx
];

Canvas2Demo
