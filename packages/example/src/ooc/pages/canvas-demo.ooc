// canvas-demo.ooc — 画布渲染示例：fc/merge/信号与 DOM 组件完全同构，
// 只是把 dom 标签换成 canvas 节点（canvasRender 负责布局 + 命中 + 重绘）。
// 计数写在画布节点里也写在下方 DOM 里，方便对比「同一信号驱动两种渲染」。
#import { dom, text, fc, bindSignal } '../bridge.ts';
#import { canvas, flex } '../bridge.ts';
#import { CanvasHeader, CanvasStat, CanvasButton, CanvasProgress } '../ui/canvas-kit.ooc';

CanvasDemo = fc $ [ctx =>
    count = bindSignal $ 0;

    (dom section { className = 'space-y-3' }
        (dom div { className = 'flex items-baseline justify-between' }
            (dom h2 { className = 'text-lg font-semibold tracking-tight' } (text $ 'Canvas 组件'))
            (dom span { className = 'text-xs text-muted-foreground' } (text $ 'mve-dom-helper/canvasRender'))
        )
        (canvas stage {
            id = 'canvas-demo-stage',
            className = 'block h-[340px] w-full rounded-xl border bg-white',
            padding = 20,
            layout = (flex $ { direction = 'y', alignItem = 'stretch', alignFix = true, gap = 16 })
        }
            (CanvasHeader $ {
                title = '画布里的组件',
                description = '布局、文本、命中与重绘都由 canvasRender 驱动'
            })
            (canvas rect {
                height = 116,
                layout = (flex $ { direction = 'x', alignItem = 'stretch', alignFix = true, gap = 12 })
            }
                (CanvasStat $ {
                    label = '画布计数',
                    value = count,
                    hint = '点击卡片或按钮 +1',
                    onClick(e){ count $ ((count $) + 1) }
                })
                (CanvasStat $ {
                    label = '节点类型',
                    value = ['rect'],
                    hint = 'rect / text / button / progress'
                })
            )
            (canvas rect {
                height = 40,
                layout = (flex $ { direction = 'x', alignItem = 'center', alignFix = true, gap = 12 })
            }
                (CanvasProgress $ { value = count, max = 10 })
                (CanvasButton $ { label = '+1', width = 88, onClick(e){ count $ ((count $) + 1) } })
                (CanvasButton $ { label = '重置', width = 88, onClick(e){ count $ 0 } })
            )
        )
        (dom p { className = 'text-xs tabular-nums text-muted-foreground' }
            (text $ ['画布计数：${count $}'])
        )
    ) $ ctx
];

CanvasDemo
