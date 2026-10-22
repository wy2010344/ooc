// orderbook.ooc — 盘口：卖盘在上、最新价居中、买盘在下，底部买卖挂单比例条。
// 数据口径对齐币安现货：Price / Amount / Total 三列、精度聚合、深度条贴右生长、B/S 比例；
// 两组控制项也照币安布局：
//   · 表头左侧三个模式图标（Both / Bids only / Asks only），当前项不透明、其余 0.4；
//   · 窗格标题右侧的 ⋯ 菜单（BookMenu）：Display Avg.&Sum、Show Buy/Sell Ratio、Rounding、
//     Book Depth Visualization（Amount / Cumulative）、Animations。
// 视图开关（mode / avgSum / ratio / rounding / cumulative / animations / step）由页面创建，
// 逐个作为 props 传进来：标题栏菜单和盘口本体共用同一组信号，页面是唯一的持有者。
// 配色与字号沿用本页的终端风格，不照搬币安皮肤。
#import { dom, text, fc, forEach, svg, iconCheck, bindSignal, bindRef } '../bridge.ts';
#import { formatPrice, formatQty } './market.ts';
#import { watchSize } './measure.ts';
#import { bestPrice, bookRowCount, bookSteps, bookView, formatShare, formatStep, formatTotal, sideSummary } './orderbook-rows.ts';
#import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } '../ui/dropdown-menu.ooc';
#import { merge, when, showIf, noop } '../ui/utils.ooc';

bookDefaults = {
    depth = nil,
    ticker = nil,
    mode = nil,
    avgSum = nil,
    ratio = nil,
    rounding = nil,
    cumulative = nil,
    animations = nil,
    step = nil,
    onPickPrice = nil
};
// 模版洞内不能出现未转义的单引号，字面量与类名先提成常量。
bidSide = 'bid';
askSide = 'ask';
bothMode = 'both';
bidsMode = 'bids';
asksMode = 'asks';
sellColor = '#fb7185';
buyColor = '#34d399';
bothLabel = 'Both';
bidsLabel = 'Bids only';
asksLabel = 'Asks only';
animOnClass = 'transition-[width] duration-300 ease-out';
animOffClass = '';
rowClass = 'relative grid h-[18px] shrink-0 cursor-pointer grid-cols-[1fr_1fr_1fr] items-center gap-2 px-3 font-mono text-[10px] tabular-nums transition-colors hover:bg-white/[0.03] active:bg-white/[0.06]';
// 每侧容器的最小高度：行数由实测高度算，见 bookRowCount
sideListClass = 'flex min-h-0 flex-1 flex-col overflow-hidden';
modeButtonBase = 'grid h-4 w-4 place-items-center rounded-[3px] transition-opacity';
modeOnClass = 'text-zinc-300 opacity-100';
modeOffClass = 'text-zinc-300 opacity-40 hover:opacity-75';
hideClass = 'hidden';
showClass = '';
menuLabelClass = 'text-[10px] uppercase tracking-[0.14em] text-zinc-500';

hideUnless = [visible =>
    #guard visible;
    showClass
    #else;
    hideClass
];
notOf = [v =>
    #guard v;
    false
    #else;
    true
];
barModeOf = [cumulative =>
    #guard cumulative;
    'cumulative'
    #else;
    'amount'
];
modeLabel = [m =>
    #guard m == bidsMode;
    bidsLabel
    #guard m == asksMode;
    asksLabel
    #else;
    bothLabel
];

sideTextClass = [side =>
    #guard side == 'ask';
    'text-rose-400'
    #else;
    'text-emerald-400'
];
sideBarClass = [side =>
    #guard side == 'ask';
    'bg-rose-500/15'
    #else;
    'bg-emerald-500/15'
];
// 模式图标左块：Both 是上下两块（卖红 / 买绿），单侧模式并成一整条。
topHeightOf = [m =>
    #guard m == bothMode;
    4.66
    #else;
    10.66
];
topFillOf = [m =>
    #guard m == bidsMode;
    buyColor
    #else;
    sellColor
];
botHeightOf = [m =>
    #guard m == bothMode;
    4.66
    #else;
    0
];

bestOf = [levels =>
    when $ ((levels length) > 0) ((levels at 0) price) 0
];
// when 是急求值的，两支都会算，读 depth 字段前必须先 guard。
askOf = [d =>
    #guard d;
    bestOf $ (d asks)
    #else;
    0
];
bidOf = [d =>
    #guard d;
    bestOf $ (d bids)
    #else;
    0
];
spreadText = [d =>
    ask = (askOf $ d);
    bid = (bidOf $ d);
    #guard (ask > 0) && (bid > 0);
    formatPrice $ (ask - bid)
    #else;
    '--'
];
lastText = [t =>
    #guard t;
    formatPrice $ (t last)
    #else;
    '--'
];
upOf = [t =>
    #guard t;
    (t change) >= 0
    #else;
    true
];
upClass = [t =>
    #guard upOf $ t;
    'text-emerald-400'
    #else;
    'text-rose-400'
];

modeIcon = fc $ [ctx, props =>
    p = merge $ props { mode = nil };
    m = (p mode);
    (svg svg { className = 'h-[15px] w-[15px]', viewBox = '0 0 16 16', fill = 'none' }
        (svg rect {
            x = 2.66,
            y = 2.66,
            width = 4.66,
            height => (topHeightOf $ m),
            fill => (topFillOf $ m)
        })
        (svg rect {
            x = 2.66,
            y = 8.66,
            width = 4.66,
            height => (botHeightOf $ m),
            fill = buyColor
        })
        (svg rect { x = 8.66, y = 2.66, width = 4.66, height = 2.66, fill = 'currentColor' })
        (svg rect { x = 8.66, y = 6.66, width = 4.66, height = 2.66, fill = 'currentColor' })
        (svg rect { x = 8.66, y = 10.66, width = 4.66, height = 2.66, fill = 'currentColor' })
    ) $ ctx
];

// value = 本按钮代表的模式；current = 页面上的 mode 信号。
modeButton = fc $ [ctx, props =>
    p = merge $ props { value = nil, current = nil };
    v = (p value);
    cur = (p current);
    (dom button {
        type = 'button',
        title => (modeLabel $ v),
        className => '${modeButtonBase} ${when $ (((cur $) == v)) modeOnClass modeOffClass}',
        onClick(e){ cur $ v }
    }
        (modeIcon $ { mode = v })
    ) $ ctx
];

// 标题栏的 ⋯ 设置菜单：币安 spot 盘口右上角那一份，5 项全部落地。
BookMenu = fc $ [ctx, props =>
    p = merge $ props { avgSum = nil, ratio = nil, rounding = nil, cumulative = nil, animations = nil };
    avgSum = (p avgSum);
    ratio = (p ratio);
    rounding = (p rounding);
    cumulative = (p cumulative);
    animations = (p animations);
    openMenu = [e =>
        (DropdownMenu $ { reference = (e currentTarget), className = 'min-w-[11.5rem]' }
            (DropdownMenuLabel $ { className = menuLabelClass } 'Order Book Display')
            (DropdownMenuCheckboxItem $ {
                getValue = avgSum,
                setValue = [v => avgSum $ v]
            } 'Display Avg. & Sum')
            (DropdownMenuCheckboxItem $ {
                getValue = ratio,
                setValue = [v => ratio $ v]
            } 'Show Buy/Sell Ratio')
            (DropdownMenuCheckboxItem $ {
                getValue = rounding,
                setValue = [v => rounding $ v]
            } 'Rounding')
            (DropdownMenuSeparator $ {})
            (DropdownMenuLabel $ { className = menuLabelClass } 'Book Depth Visualization')
            (DropdownMenuItem $ { onPress(e){ cumulative $ false } }
                'Amount'
                (showIf $ (when $ (notOf $ (cumulative $)) (iconCheck $ { className = 'ml-auto size-3 text-zinc-300' }) nil))
            )
            (DropdownMenuItem $ { onPress(e){ cumulative $ true } }
                'Cumulative'
                (showIf $ (when $ (cumulative $) (iconCheck $ { className = 'ml-auto size-3 text-zinc-300' }) nil))
            )
            (DropdownMenuSeparator $ {})
            (DropdownMenuCheckboxItem $ {
                getValue = animations,
                setValue = [v => animations $ v]
            } 'Animations')
        )
    ];

    (dom button {
        type = 'button',
        title = 'Order book settings',
        className = 'grid h-6 w-6 shrink-0 place-items-center rounded-sm text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200',
        onClick(e){ openMenu $ e }
    }
        (svg svg { className = 'h-3.5 w-3.5', viewBox = '0 0 24 24', fill = 'currentColor' }
            (svg circle { cx = 5, cy = 12, r = 1.5 })
            (svg circle { cx = 12, cy = 12, r = 1.5 })
            (svg circle { cx = 19, cy = 12, r = 1.5 })
        )
    ) $ ctx
];

// 一侧的均价 / 合计（Display Avg.&Sum）。币安在窄面板里看不到这组的落点，
// 这里落成每侧底部一行统计，信息等价且不占列宽。
// rowsOf 传 thunk（不是现成数组），否则深度更新后统计不会跟着变。
SideSummary = fc $ [ctx, props =>
    p = merge $ props { rowsOf = nil, side = nil, rounding = nil };
    sideOf = [sideSummary $ ((p rowsOf) $ nil)];
    exact = [notOf $ (((p rounding) $))];
    (dom div {
        className = 'flex shrink-0 items-center justify-between gap-2 border-t border-white/5 px-3 py-[1px] font-mono text-[9px] text-zinc-600'
    }
        (dom span { className => 'min-w-0 truncate whitespace-nowrap ${sideTextClass $ (p side)}' }
            (text $ ['AVG ${formatPrice $ ((sideOf $) avg)}'])
        )
        (dom span { className = 'min-w-0 truncate text-right whitespace-nowrap' }
            (text $ ['Σ ${formatTotal $ ((sideOf $) sum) (exact $)}'])
        )
    ) $ ctx
];

Orderbook = fc $ [ctx, props =>
    p = merge $ props bookDefaults;
    // 每侧能放几档取决于容器实测高度：拖动分栏、切单侧都会重算。
    askHeight = bindSignal $ 0;
    bidHeight = bindSignal $ 0;
    askDisconnect = bindRef $ noop;
    bidDisconnect = bindRef $ noop;
    rowsOf = [bookRowCount $ (askHeight $) (bidHeight $)];
    // 当前视图：深度 + 精度 + 条口径，三个开关都会影响同一次 bookView。
    viewOf = [s, md => bookView $ (p depth $) (rowsOf $) s (barModeOf $ ((p cumulative) $))];
    fmtTotal = [v => formatTotal $ v (notOf $ ((p rounding) $))];
    asksView = [x => ((viewOf $ ((p step) $) ((p mode) $)) asks)];
    bidsView = [x => ((viewOf $ ((p step) $) ((p mode) $)) bids)];
    shareOf = [side =>
        v = (viewOf $ ((p step) $) ((p mode) $));
        #guard side == bidSide;
        formatShare $ (v buyRatio)
        #else;
        formatShare $ (1 - (v buyRatio))
    ];

    // 精度下拉：按最小步长 ×10 递进。
    openSteps = [e =>
        (DropdownMenu $ { reference = (e currentTarget), className = 'min-w-[7.5rem]' }
            (DropdownMenuLabel $ { className = menuLabelClass } 'Price aggregation')
            (forEach $ {
                forEach(block){ (bookSteps $ (bestPrice $ (p depth $))) forEach [v, i => block $ i v] },
                creater(ic, et, key){
                    (DropdownMenuItem $ { onPress(e){ ((p step) $ (et value)) } }
                        (text $ [formatStep $ (et value)])
                    ) $ ic
                }
            })
        )
    ];

    // 点击某一档把价格填进 Paper order（币安点盘口也是这个行为）。
    pickPrice = [price =>
        #guard (p onPickPrice);
        ((p onPickPrice) $ price)
        #else;
        nil
    ];

    // 单行：深度条贴右边，宽度由 bookView 算好的 percent 决定。
    bookRow = [ic, et =>
        (dom div {
            className => rowClass,
            onClick(e){ pickPrice $ (et value/ price) }
        }
            (dom div {
                className => 'pointer-events-none absolute inset-y-0 right-0 ${sideBarClass $ (et value/ side)} ${when $ ((p animations) $) animOnClass animOffClass}',
                s_width => '${et value/ percent}%'
            })
            (dom span { className => 'relative z-10 ${sideTextClass $ (et value/ side)}' }
                (text $ [formatPrice $ (et value/ price)])
            )
            (dom span { className = 'relative z-10 text-right text-zinc-400' }
                (text $ [formatQty $ (et value/ qty)])
            )
            (dom span { className = 'relative z-10 text-right text-zinc-500' }
                (text $ [fmtTotal $ (et value/ total)])
            )
        ) $ ic
    ];

    (dom div { className = 'flex h-full flex-col' }
        // 表头工具行：左边是买卖盘模式，右边是精度（币安就在同一行）
        (dom div { className = 'flex shrink-0 items-center justify-between px-2 pt-1 pb-[3px]' }
            (dom div { className = 'flex items-center gap-[2px]' }
                (modeButton $ { value = bothMode, current = (p mode) })
                (modeButton $ { value = bidsMode, current = (p mode) })
                (modeButton $ { value = asksMode, current = (p mode) })
            )
            (dom button {
                type = 'button',
                className = 'rounded-sm border border-white/10 px-1.5 py-[1px] font-mono text-[10px] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200',
                onClick(e){ openSteps $ e }
            }
                (text $ [formatStep $ ((viewOf $ ((p step) $) ((p mode) $)) step)])
            )
        )

        (dom div {
            className = 'grid shrink-0 grid-cols-[1fr_1fr_1fr] gap-2 border-b border-white/5 px-3 py-1 text-[9px] uppercase tracking-[0.14em] text-zinc-600'
        }
            (dom span {} 'Price')
            (dom span { className = 'text-right' } 'Amount')
            (dom span { className = 'text-right' } 'Total')
        )

        // 卖盘：远价在上，最优价贴着中间行；只看买盘时整块隐藏。
        // 行数按容器高度算，容器本身 overflow-hidden 兜底裁剪。
        (dom div {
            className => '${sideListClass} justify-end ${hideUnless $ (((p mode) $) != bidsMode)}',
            plugin(el){ askDisconnect $ (watchSize $ el [s => askHeight $ (s height)]) },
            willRemove(el){ ((askDisconnect $) $) }
        }
            (forEach $ {
                forEach(block){ ((viewOf $ ((p step) $) ((p mode) $)) asks) forEach [r, i => block $ i r] },
                creater(ic, et, key){ bookRow $ ic et }
            })
        )
        (dom div { className => 'flex shrink-0 ${hideUnless $ ((p avgSum) $)}' }
            (SideSummary $ { rowsOf = asksView, side = askSide, rounding = (p rounding) })
        )

        // 中间：最新成交价 + 价差
        (dom div {
            className = 'flex shrink-0 items-center justify-between border-y border-white/5 bg-white/[0.02] px-3 py-1'
        }
            (dom div { className = 'flex items-baseline gap-1' }
                (dom span { className => 'font-mono text-[15px] font-medium ${upClass $ (p ticker $)}' }
                    (text $ [lastText $ (p ticker $)])
                )
                (dom span { className => 'text-[10px] ${upClass $ (p ticker $)}' }
                    (text $ [when $ (upOf $ (p ticker $)) '↑' '↓'])
                )
            )
            (dom span { className = 'font-mono text-[10px] text-zinc-500' }
                (text $ ['Spread ${spreadText $ (p depth $)}'])
            )
        )

        // 买盘：最优价贴着中间行；只看卖盘时整块隐藏
        (dom div {
            className => '${sideListClass} justify-start ${hideUnless $ (((p mode) $) != asksMode)}',
            plugin(el){ bidDisconnect $ (watchSize $ el [s => bidHeight $ (s height)]) },
            willRemove(el){ ((bidDisconnect $) $) }
        }
            (forEach $ {
                forEach(block){ ((viewOf $ ((p step) $) ((p mode) $)) bids) forEach [r, i => block $ i r] },
                creater(ic, et, key){ bookRow $ ic et }
            })
        )
        (dom div { className => 'flex shrink-0 ${hideUnless $ ((p avgSum) $)}' }
            (SideSummary $ { rowsOf = bidsView, side = bidSide, rounding = (p rounding) })
        )

        // 底部：买卖两边挂单金额占比
        (dom div {
            className => 'flex shrink-0 items-center gap-2 border-t border-white/5 px-3 py-[5px] font-mono text-[9px] ${hideUnless $ ((p ratio) $)}'
        }
            (dom span { className = 'text-emerald-400' }
                (text $ ['B ${shareOf $ bidSide}%'])
            )
            (dom div { className = 'relative h-[3px] flex-1 overflow-hidden rounded-full bg-rose-500/30' }
                (dom div {
                    className = 'h-full rounded-full bg-emerald-500/70',
                    s_width => '${shareOf $ bidSide}%'
                })
            )
            (dom span { className = 'text-rose-400' }
                (text $ ['${shareOf $ askSide}% S'])
            )
        )
    ) $ ctx
];

{ Orderbook = Orderbook, BookMenu = BookMenu, bothMode = bothMode }
