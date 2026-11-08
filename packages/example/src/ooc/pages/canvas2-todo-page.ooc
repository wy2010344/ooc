// canvas2 待办看板：数据层(store) + 行组件(item) + 本文的页面骨架。
// 所有组件都是 lambda 工厂（#import 后直接调用），文字一律走 textNode 自量尺寸。
// 交互只在事件 / draw / 读取器里读信号，构建期不冻结任何状态。
#import { dom, text, fc, forEach, flex2, colorToCSS } '../bridge.ts';
#import { SiteNav } './site-nav.ooc';
#import { rect, scrollBox, stage, textNode } '../../../../ooc-mve-bridge/src/canvas2/index.ooc';
#import { paintRound } './canvas2-todo-ui.ooc';
#import { todoRow } './canvas2-todo-item.ooc';
#import {
    rowGap,
    paletteOf,
    themeNow,
    filterNow,
    setFilter,
    hoverTodo,
    visibleTodos,
    todosNow,
    progressOf,
    statsText,
    selectedTextOf,
    addTodo,
    clearDone,
    undoTodo,
    redoTodo,
    canUndo,
    canRedo,
    toggleTheme
} './canvas2-todo-store.ooc';

// ---- 过滤页签 ----
filterLabelOf = [key =>
    #guard (key == 'active');
    '未完成'
    #guard (key == 'done');
    '已完成'
    #else;
    '全部'
];

tabBgOf = [p, current, key => #guard (current == key); p accent #else; p card];
tabBorderOf = [p, current, key => #guard (current == key); p accent #else; p border];
tabTextOf = [p, current, key => #guard (current == key); p onAccent #else; p text];

filterTab = [key, getPal =>
    (rect $ {
        width = 96,
        height = 30,
        radius = 8,
        borderWidth = 1,
        background { tabBgOf $ (getPal $) (filterNow $) key },
        borderColor { tabBorderOf $ (getPal $) (filterNow $) key },
        layout = (flex2 $ { direction = 'x', alignItem = 'center',alignFix=true, directionJustify = 'center' }),
        mouseClick(e) { setFilter $ key }
    }
        (textNode $ {
            text = (filterLabelOf $ key),
            fontSize = 12,
            fontWeight = 600,
            color { tabTextOf $ (getPal $) (filterNow $) key },
            autoWidth = true
        })
    )
];

// ---- 操作按钮 ----
btnBgOf = [p, primary, enabled =>
    #guard (enabled == false);
    p cardDone
    #guard primary;
    p accent
    #else;
    p card
];

btnBorderOf = [p, primary, enabled =>
    #guard (enabled == false);
    p border
    #guard primary;
    p accent
    #else;
    p borderStrong
];

btnTextOf = [p, primary, enabled =>
    #guard (enabled == false);
    p muted
    #guard primary;
    p onAccent
    #else;
    p text
];

actionButton = [op =>
    label = op label;
    w = op w;
    primary = op primary;
    getPal = op getPal;
    enabledOf = op enabledOf;
    act = op act;
    (rect $ {
        width = w,
        height = 32,
        radius = 8,
        borderWidth = 1,
        background { btnBgOf $ (getPal $) primary (enabledOf $) },
        borderColor { btnBorderOf $ (getPal $) primary (enabledOf $) },
        layout = (flex2 $ { direction = 'x', alignItem = 'center', alignFix=true,directionJustify = 'center' }),
        mouseClick(e) {
            #guard (enabledOf $);
            act $
        }
    }
        (textNode $ {
            text = label,
            fontSize = 12,
            fontWeight = 600,
            color { btnTextOf $ (getPal $) primary (enabledOf $) },
            autoWidth = true
        })
    )
];

// ---- 各区块 ----
// 头部：纵向排版，标题行 / 副标题 / 进度条全部是子节点（高度由内容撑开）
headerCard = [getPal =>
    (rect $ {
        width = 380,
        radius = 12,
        borderWidth = 1,
        background { (getPal $) card },
        borderColor { (getPal $) border },
        paddingBlock = 16,
        paddingInline = 16,
        layout = (flex2 $ { direction = 'y', gap = 8, alignItem = 'stretch', alignFix = true })
    }
        (rect $ {
            height = 24,
            layout = (flex2 $ { direction = 'x', alignItem = 'center', directionJustify = 'between', alignFix = true })
        }
            (textNode $ {
                text = '待办清单',
                fontSize = 18,
                fontWeight = 700,
                color { (getPal $) text },
                autoWidth = true
            })
            (textNode $ {
                text { statsText $ },
                fontSize = 12,
                fontWeight = 600,
                color { (getPal $) text },
                autoWidth = true
            })
        )
        (textNode $ {
            text = 'canvas2 · 消息驱动 / 滚轮 / 撤销重做 / 主题',
            fontSize = 11,
            fontWeight = 400,
            color { (getPal $) muted },
            autoWidth = true
        })
        (rect $ {
            height = 6,
            radius = 3,
            background { (getPal $) track },
            draw(ctx2, node) {
                fillW = ((node width) * (progressOf $)) div 100;
                #guard (fillW > 0);
                paintRound $ { ctx2 = ctx2, x = 0, y = 0, w = fillW, h = 6, r = 3, color = ((getPal $) accent) }
            }
        })
    )
];

filterRow = [getPal =>
    (rect $ {
        width = 380,
        height = 30,
        layout = (flex2 $ { direction = 'x', gap = 8, alignItem = 'center', alignFix = true, directionJustify = 'center' })
    }
        (filterTab $ 'all' getPal)
        (filterTab $ 'active' getPal)
        (filterTab $ 'done' getPal)
    )
];

// 空态文字：不参与内容布局（避免反过来撑高内容），只在列表为空时显示
emptyHint = [getPal =>
    (textNode $ {
        text = '没有符合条件的待办',
        fontSize = 12,
        fontWeight = 400,
        color { (getPal $) muted },
        autoWidth = true,
        notInLayout = true,
        hide { ((visibleTodos $) length) > 0 },
        position(d, node) {
            content = node parent;
            container = content parent;
            #guard (d == 'x');
            ((content width) - (node width)) div 2
            #else;
            (((container height) - (container paddingBlockStart) - (container paddingBlockEnd)) - (node height)) div 2
        }
    })
];

listCard = [getPal =>
    (scrollBox $ {
        width = 380,
        height = 340,
        gap = rowGap,
        radius = 12,
        paddingBlockStart = 8,
        paddingBlockEnd = 8,
        paddingInlineStart = 8,
        paddingInlineEnd = 12,
        background { (getPal $) card },
        borderColor { (getPal $) border },
        borderWidth = 1,
        thumbColor { (getPal $) thumb }
    }
        (forEach $ {
            forEach(block) {
                (visibleTodos $) forEach [t => block $ (t id) t]
            },
            creater(ic, et) {
                (todoRow $ ic et getPal)
            }
        })
        (emptyHint $ getPal)
    )
];

actionRow = [getPal =>
    (rect $ {
        width = 380,
        height = 32,
        layout = (flex2 $ { direction = 'x', gap = 8, alignItem = 'center', alignFix = true, directionJustify = 'center' })
    }
        (actionButton $ { label = '添加', w = 64, primary = true, getPal = getPal, enabledOf = [true], act = addTodo })
        (actionButton $ { label = '清除已完成', w = 92, primary = false, getPal = getPal, enabledOf = [true], act = clearDone })
        (actionButton $ { label = '撤销', w = 56, primary = false, getPal = getPal, enabledOf = canUndo, act = undoTodo })
        (actionButton $ { label = '重做', w = 56, primary = false, getPal = getPal, enabledOf = canRedo, act = redoTodo })
        (actionButton $ { label = '主题', w = 56, primary = false, getPal = getPal, enabledOf = [true], act = toggleTheme })
    )
];

footerRow = [getPal =>
    (rect $ {
        width = 380,
        height = 22,
        layout = (flex2 $ { direction = 'x', alignItem = 'center', directionJustify = 'between', alignFix = true })
    }
        (textNode $ {
            text { '可见 ${((visibleTodos $) length)} / 全部 ${((todosNow $) length)}' },
            fontSize = 11,
            fontWeight = 400,
            color { (getPal $) muted },
            autoWidth = true
        })
        (textNode $ {
            text { '选中：${(selectedTextOf $)}' },
            fontSize = 11,
            fontWeight = 400,
            color { (getPal $) muted },
            autoWidth = true
        })
    )
];

Canvas2TodoDemo = fc $ [ctx =>
    getPal = [ paletteOf $ (themeNow $)];
    (dom section { className = 'space-y-3' }
        (dom div { className = 'flex items-baseline justify-between' }
            (dom h2 { className = 'text-lg font-semibold tracking-tight' } (text $ 'Canvas2 待办看板'))
            (dom span { className = 'text-xs text-muted-foreground' }
                (text $ '滚动 / 过滤 / 勾选 / 撤销重做 / 主题')
            )
        )
        (stage $ {
            id = 'canvas2-todo-stage',
            className = 'block h-[600px] w-full rounded-xl border bg-card',
            layout = (flex2 $ { direction = 'y', gap = 10, alignItem = 'center', alignFix = true }),
            draw(ctx2, node) {
                ctx2 fillStyle (colorToCSS $ ((getPal $) page));
                ctx2 fillRect 0 0 (node width) (node height)
            },
            mouseMoveCapture(e) { hoverTodo $ 0 }
        }
            (headerCard $ getPal)
            (filterRow $ getPal)
            (listCard $ getPal)
            (actionRow $ getPal)
            (footerRow $ getPal)
        )
    ) $ ctx
];

Canvas2TodoDemo
