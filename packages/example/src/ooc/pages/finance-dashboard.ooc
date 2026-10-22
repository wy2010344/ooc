// finance-dashboard.ooc — 深色行情终端：三列可拖拽窗格 + 币安公开行情。
// 不接账户/交易接口；下单窗格是纯 UI 演示（Paper）。
// 页面从外观到数据都贴着 Binance 公开行情，因此首次进入会弹一次免责声明，
// 标题栏的 DEMO 与页脚常驻文案随时可复查（见 dashboard/legal.ooc）。
#import { dom, text, fc, bindSignal, bindRef } '../bridge.ts';
#import { noop, when } '../ui/utils.ooc';
#import { Pane, VSplit, HSplit } '../dashboard/pane.ooc';
#import { Watchlist } '../dashboard/watchlist.ooc';
#import { Chart } '../dashboard/chart.ooc';
#import { DepthChart } '../dashboard/depth-chart.ooc';
#import { Orderbook, BookMenu, bothMode } '../dashboard/orderbook.ooc';
#import { Trades } '../dashboard/trades.ooc';
#import { Stats } '../dashboard/stats.ooc';
#import { Ticket } '../dashboard/ticket.ooc';
#import { LegalNotice } '../dashboard/legal.ooc';
#import { whenFirstVisit, markNoticeSeen } '../dashboard/notice.ts';
#import {
    createMarketSession,
    createWatchlistSession,
    upsertTicker,
    upsertKline,
    pushTrade,
    formatPrice,
    formatPercent,
    toggleMockMode
} '../dashboard/feed.ts';
#import { dragSplit, loadLayout, saveLayout, resetLayout } '../dashboard/layout.ts';

watchSymbols = (Array of 'BTCUSDT' 'ETHUSDT' 'SOLUSDT' 'BNBUSDT' 'XRPUSDT' 'DOGEUSDT');

tabClass = [active =>
    #guard active;
    'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
    #else;
    'border-transparent text-zinc-500 hover:text-zinc-200'
];
changeClass = [value =>
    #guard value >= 0;
    'text-emerald-400'
    #else;
    'text-rose-400'
];
hideUnless = [visible =>
    #guard visible;
    ''
    #else;
    'hidden'
];
// 模版洞内不能再出现未转义单引号，活动区 key 提到洞外做比较。
depthActivity = 'Depth';
tradesActivity = 'Trades';
lastText = [t =>
    #guard t;
    formatPrice $ (t last)
    #else;
    '--'
];
changeOf = [t =>
    #guard t;
    (t changePercent)
    #else;
    0
];
statusDot = [value =>
    #guard value == 'live';
    'bg-emerald-400'
    #else;
    when $ (value == 'mock') 'bg-sky-400' (when $ (value == 'polling') 'bg-amber-400' (when $ (value == 'reconnecting') 'bg-amber-400' 'bg-zinc-500'))
];
statusLabel = [value =>
    #guard value == 'live';
    'LIVE'
    #else;
    when $ (value == 'mock') 'MOCK' (when $ (value == 'polling') 'POLLING' (when $ (value == 'reconnecting') 'RECONNECTING' (when $ (value == 'connecting') 'CONNECTING' 'OFFLINE')))
];
mockClass = [value =>
    #guard value == 'mock';
    'border-sky-400/40 bg-sky-400/10 text-sky-300'
    #else;
    'border-white/10 text-zinc-500 hover:border-white/25 hover:text-zinc-200'
];
mockLabel = [value =>
    #guard value == 'mock';
    'MOCK ON'
    #else;
    'MOCK'
];

// current 传信号（不是算好的布尔），className 每次取值都读一次，选中态才会跟随切换。
Tab = fc $ [ctx, label, current, onPick =>
    (dom button {
        type = 'button',
        className => 'rounded-sm border px-2.5 py-1 font-mono text-[10px] tracking-wide transition-colors ${tabClass $ ((current $) == label)}',
        onClick(e){ onPick $ label }
    } (text $ label)) $ ctx
];

FinanceDashboard = fc $ [ctx =>
    layout = (loadLayout $);
    leftWidth = bindSignal $ (layout leftWidth);
    rightWidth = bindSignal $ (layout rightWidth);
    leftBottom = bindSignal $ (layout leftBottom);
    centerBottom = bindSignal $ (layout centerBottom);
    rightBottom = bindSignal $ (layout rightBottom);

    symbol = bindSignal $ 'BTCUSDT';
    interval = bindSignal $ '15m';
    activity = bindSignal $ 'Depth';
    ticker = bindSignal $ nil;
    klines = bindSignal $ (Array of);
    depth = bindSignal $ nil;
    trades = bindSignal $ (Array of);
    watch = bindSignal $ (Array of);
    status = bindSignal $ 'connecting';
    error = bindSignal $ '';
    // 盘口的视图开关：标题栏 ⋯ 菜单和盘口本体共用同一份，故提到页面层创建。
    // 必须按语句创建信号——写进对象字面量会被当成 getter，每次读都重建一次。
    bookMode = bindSignal $ bothMode;
    bookAvgSum = bindSignal $ false;
    bookRatio = bindSignal $ true;
    bookRounding = bindSignal $ true;
    bookCumulative = bindSignal $ false;
    bookAnimations = bindSignal $ true;
    bookStep = bindSignal $ 0;
    // 盘口点价：nil 表示跟随最新价，点某一档后作为 Paper order 的限价。
    limitPrice = bindSignal $ nil;

    saveNow = [
        saveLayout $ {
            leftWidth = (leftWidth $),
            rightWidth = (rightWidth $),
            leftBottom = (leftBottom $),
            centerBottom = (centerBottom $),
            rightBottom = (rightBottom $)
        }
    ];
    reset = [e =>
        next = (resetLayout $);
        leftWidth $ (next leftWidth);
        rightWidth $ (next rightWidth);
        leftBottom $ (next leftBottom);
        centerBottom $ (next centerBottom);
        rightBottom $ (next rightBottom)
    ];

    dragLeft = [e => dragSplit $ e 'x' (leftWidth $) 1 176 420 [v => leftWidth $ v] [saveNow $]];
    dragRight = [e => dragSplit $ e 'x' (rightWidth $) (0 - 1) 224 520 [v => rightWidth $ v] [saveNow $]];
    dragLeftBottom = [e => dragSplit $ e 'y' (leftBottom $) (0 - 1) 120 420 [v => leftBottom $ v] [saveNow $]];
    dragCenterBottom = [e => dragSplit $ e 'y' (centerBottom $) (0 - 1) 120 420 [v => centerBottom $ v] [saveNow $]];
    dragRightBottom = [e => dragSplit $ e 'y' (rightBottom $) (0 - 1) 120 420 [v => rightBottom $ v] [saveNow $]];

    handlers = {
        onSnapshot(snapshot){
            ticker $ (snapshot ticker);
            klines $ (snapshot klines);
            depth $ (snapshot depth);
            trades $ (snapshot trades);
            error $ ''
        },
        onTicker(t){ ticker $ t },
        onKline(k){ klines $ (upsertKline $ (klines $) k) },
        onDepth(d){ depth $ d },
        onTrade(t){ trades $ (pushTrade $ (trades $) t) },
        onStatus(s){ status $ s },
        onError(message){ error $ message }
    };

    closeMarket = bindRef $ noop;
    openMarket = [sym, itv =>
        ((closeMarket $) $);
        depth $ nil;
        closeMarket $ (createMarketSession $ sym itv handlers)
    ];
    selectSymbol = [s =>
        #guard s != (symbol $);
        symbol $ s;
        limitPrice $ nil;
        error $ '';
        openMarket $ s (interval $)
    ];
    selectInterval = [v =>
        #guard v != (interval $);
        interval $ v;
        error $ '';
        openMarket $ (symbol $) v
    ];

    // 顶部状态只反映主行情连接；自选行情不覆盖它，避免两个连接互相闪烁。
    watchHandlers = {
        onTickers(list){ watch $ list },
        onTicker(t){ watch $ (upsertTicker $ (watch $) t) },
        onError(message){ error $ message }
    };

    openMarket $ (symbol $) (interval $);
    ctx addDestroy [ (closeMarket $) $ ];
    closeWatch = createWatchlistSession $ watchSymbols watchHandlers;
    ctx addDestroy [closeWatch];

    // 免责声明：标题栏 DEMO 随时可开；首次进入自动弹一次（已读标记只存本机）。
    // 弹层是页面内的普通节点（fixed 定位），跟着页面一起卸载，不走 portal。
    noticeOpen = bindSignal $ false;
    noticeFirst = bindSignal $ true;
    openNotice = [ noticeOpen $ true ];
    dismissNotice = [ noticeOpen $ false ];
    acceptNotice = [
        markNoticeSeen $;
        noticeOpen $ false
    ];
    cancelNotice = whenFirstVisit $ [ noticeOpen $ true ];
    ctx addDestroy [cancelNotice];

    (dom div { className = 'flex h-screen flex-col overflow-hidden bg-[#070a0e] text-zinc-100' }
        (dom header {
            className = 'flex h-[52px] shrink-0 items-center gap-4 border-b border-white/8 bg-[#0b0f14] px-3'
        }
            (dom a {
                href = '#/',
                className = 'flex shrink-0 items-center gap-2 text-zinc-400 transition-colors hover:text-zinc-100'
            }
                (dom span {
                    className = 'grid h-6 w-6 place-items-center rounded-sm bg-emerald-400 font-mono text-[10px] font-bold text-zinc-950'
                } 'O')
                (dom span { className = 'text-[11px] font-semibold uppercase tracking-[0.18em]' } 'OOC Markets')
            )

            (dom div { className = 'flex min-w-0 items-baseline gap-2 border-l border-white/8 pl-4' }
                (dom h1 { className = 'font-mono text-sm font-semibold tracking-wide' } (text $ [symbol $]))
                (dom span { className = 'font-mono text-sm tabular-nums text-zinc-200' }
                    (text $ [lastText $ (ticker $)])
                )
                (dom span {
                    className => 'font-mono text-[11px] tabular-nums ${changeClass $ (changeOf $ (ticker $))}'
                }
                    (text $ [formatPercent $ (changeOf $ (ticker $))])
                )
            )

            (dom nav { className = 'ml-auto flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]' }
                (dom div { className = 'flex items-center gap-1 border-r border-white/8 pr-3' }
                    (Tab $ 'BTCUSDT' symbol [s => selectSymbol $ s])
                    (Tab $ 'ETHUSDT' symbol [s => selectSymbol $ s])
                    (Tab $ 'SOLUSDT' symbol [s => selectSymbol $ s])
                    (Tab $ 'BNBUSDT' symbol [s => selectSymbol $ s])
                )
                (dom div { className = 'flex items-center gap-1 pl-2' }
                    (Tab $ '1m' interval [v => selectInterval $ v])
                    (Tab $ '5m' interval [v => selectInterval $ v])
                    (Tab $ '15m' interval [v => selectInterval $ v])
                    (Tab $ '1h' interval [v => selectInterval $ v])
                )
            )

            (dom div { className = 'flex shrink-0 items-center gap-3' }
                // 常驻入口：随时复查免责声明（首次进入会自动弹一次）。
                // 只切本页的 visible 信号，不碰 portal，切页时不会撞「计算期间不允许修改值」。
                (dom button {
                    type = 'button',
                    title = '演示环境：查看免责声明',
                    className = 'rounded-sm border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[9px] tracking-[0.12em] text-amber-300 transition-colors hover:bg-amber-400/20',
                    onClick(e){ openNotice $ }
                } 'DEMO')
                (dom div { className = 'flex items-center gap-1.5' }
                    (dom span { className => 'h-1.5 w-1.5 rounded-full ${statusDot $ (status $)}' })
                    (dom span { className = 'font-mono text-[9px] tracking-[0.12em] text-zinc-500' }
                        (text $ [statusLabel $ (status $)])
                    )
                )
                // 数据源开关：按钮亮起表示「当前吃的就是本机伪报文」，
                // 不是偏好值——服务没起时点了也不会亮，只在下面提示原因。
                (dom button {
                    type = 'button',
                    className => 'rounded-sm border px-2 py-1 font-mono text-[9px] transition-colors ${mockClass $ (status $)}',
                    onClick(e){ toggleMockMode $ e }
                }
                    (text $ [mockLabel $ (status $)])
                )
                (dom button {
                    type = 'button',
                    className = 'rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] text-zinc-500 transition-colors hover:border-white/25 hover:text-zinc-200',
                    onClick(e){ reset $ e }
                } 'RESET LAYOUT')
            )
        )

        (dom main { className = 'flex min-h-0 flex-1 gap-0 p-2' }
            // 左列：自选 + 概览
            (dom div {
                className = 'flex min-w-0 shrink-0 flex-col',
                s_width => '${leftWidth $}px'
            }
                (Pane $ { title = 'Watchlist', hint = '24h', className = 'flex-1' }
                    (Watchlist $ { tickers = watch, active = symbol, onPick = selectSymbol })
                )
                (HSplit $ dragLeftBottom)
                (dom div {
                    className = 'flex min-h-0 flex-col',
                    s_height => '${leftBottom $}px'
                }
                    (Pane $ { title = 'Market stats', hint = 'Binance', className = 'flex-1' }
                        (Stats $ { ticker = ticker })
                    )
                )
            )

            (VSplit $ dragLeft)

            // 中列：K 线 + 成交
            (dom div { className = 'flex min-w-0 flex-1 flex-col' }
                (Pane $ { title = 'Chart', hint = 'Live', className = 'min-h-[180px] flex-1' }
                    (Chart $ { klines = klines, interval = interval })
                )
                (HSplit $ dragCenterBottom)
                (dom div {
                    className = 'flex min-h-0 flex-col',
                    s_height => '${centerBottom $}px'
                }
                    (Pane $ { title = 'Market activity', hint = 'Trades / Depth', className = 'flex-1' }
                        (dom div { className = 'flex h-full flex-col' }
                            (dom div {
                                className = 'flex shrink-0 items-center gap-1 border-b border-white/5 px-2 py-1'
                            }
                                (Tab $ 'Depth' activity [v => activity $ v])
                                (Tab $ 'Trades' activity [v => activity $ v])
                            )
                            (dom div {
                                className => 'min-h-0 flex-1 ${hideUnless $ ((activity $) == depthActivity)}'
                            }
                                (DepthChart $ { depth = depth })
                            )
                            (dom div {
                                className => 'min-h-0 flex-1 ${hideUnless $ ((activity $) == tradesActivity)}'
                            }
                                (Trades $ { trades = trades })
                            )
                        )
                    )
                )
            )

            (VSplit $ dragRight)

            // 右列：盘口 + 模拟下单
            (dom div {
                className = 'flex min-w-0 shrink-0 flex-col',
                s_width => '${rightWidth $}px'
            }
                (Pane $ {
                    title = 'Order book',
                    hint = 'L2 aggregated',
                    className = 'flex-1',
                    tools = (BookMenu $ {
                        avgSum = bookAvgSum,
                        ratio = bookRatio,
                        rounding = bookRounding,
                        cumulative = bookCumulative,
                        animations = bookAnimations
                    })
                }
                    (Orderbook $ {
                        depth = depth,
                        ticker = ticker,
                        onPickPrice = [price => limitPrice $ price],
                        mode = bookMode,
                        avgSum = bookAvgSum,
                        ratio = bookRatio,
                        rounding = bookRounding,
                        cumulative = bookCumulative,
                        animations = bookAnimations,
                        step = bookStep
                    })
                )
                (HSplit $ dragRightBottom)
                (dom div {
                    className = 'flex min-h-0 flex-col',
                    s_height => '${rightBottom $}px'
                }
                    (Pane $ { title = 'Paper order', hint = 'Demo only', className = 'flex-1' }
                        (Ticket $ { ticker = ticker, price = limitPrice })
                    )
                )
            )
        )

        (dom footer {
            className = 'flex h-6 shrink-0 items-center justify-between border-t border-white/6 px-3 font-mono text-[9px] tracking-wide text-zinc-600'
        }
            (dom span {} 'UNOFFICIAL DEMO · BINANCE PUBLIC DATA · NO API KEY · NOT INVESTMENT ADVICE')
            (dom span { className = 'normal-case text-rose-400/70' } (text $ error))
        )

        // 免责声明弹层：始终在树上，靠 visible 切换显隐（详见 dashboard/legal.ooc）。
        (LegalNotice $ {
            visible = noticeOpen,
            firstTime = noticeFirst,
            onDismiss = dismissNotice,
            onAccept = acceptNotice
        })
    ) $ ctx
];

FinanceDashboard
