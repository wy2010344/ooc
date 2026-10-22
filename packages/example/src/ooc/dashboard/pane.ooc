// pane.ooc — 看板窗格外壳 + 可拖拽分隔条。
// 窗格只负责标题栏和裁剪，内容由调用方通过剩余参数传入；
// 标题栏右侧的控件（如币安那种 ⋯ 设置菜单）走 tools 槽，传一个组件即可。
#import { dom, text, fc } '../bridge.ts';
#import { merge, showIf } '../ui/utils.ooc';

paneDefaults = { title = '', hint = '', className = nil, tools = nil };

Pane = fc $ [ctx, props, ...children =>
    p = merge $ props paneDefaults;
    (dom section {
        className => 'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-white/8 bg-[#0d1218] ${p className}'
    }
        (dom header {
            className = 'flex h-9 shrink-0 items-center justify-between gap-2 border-b border-white/6 bg-white/[0.015] px-3'
        }
            (dom div { className = 'flex min-w-0 items-baseline gap-2' }
                (dom h2 {
                    className = 'truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400'
                } (text $ (p title)))
                (dom span { className = 'truncate text-[10px] text-zinc-600' } (text $ (p hint)))
            )
            (showIf $ (p tools))
        )
        (dom div { className = 'relative min-h-0 flex-1 overflow-hidden' } ...children)
    ) $ ctx
];

// 竖向分隔条：拖动改变左右窗格宽度。
VSplit = fc $ [ctx, onDrag =>
    (dom div {
        className = 'group relative z-10 flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-transparent',
        onPointerDown(e){ onDrag $ e }
    }
        (dom div {
            className = 'h-full w-px bg-white/6 transition-colors group-hover:bg-emerald-400/50 group-active:bg-emerald-400'
        })
    ) $ ctx
];

// 横向分隔条：拖动改变上下窗格高度。
HSplit = fc $ [ctx, onDrag =>
    (dom div {
        className = 'group relative z-10 flex h-1.5 shrink-0 cursor-row-resize items-center justify-center bg-transparent',
        onPointerDown(e){ onDrag $ e }
    }
        (dom div {
            className = 'h-px w-full bg-white/6 transition-colors group-hover:bg-emerald-400/50 group-active:bg-emerald-400'
        })
    ) $ ctx
];

{ Pane = Pane, VSplit = VSplit, HSplit = HSplit }
