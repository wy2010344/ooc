// chart.ooc — K 线窗格：DOM 绝对定位绘制蜡烛与成交量，支持滚轮缩放 / 拖拽平移 / 十字线。
// 几何全部在 chart-view.ts（视口、蜡烛盒、刻度、悬停），组件只装配 DOM 与交互状态。
// 交互与币安一致：滚轮以光标为锚点缩放、按住拖动平移、双击回到最新、悬停显示 OHLC。
#import { dom, text, fc, forEach, bindSignal, bindRef } '../bridge.ts';
#import { formatPrice } './market.ts';
#import { watchSize } './measure.ts';
#import { chartLayout, chartHover, formatAxisPrice, zoomByEvent, zoomByStep, panByPixels, capturePointer, releasePointer, pointerRatio, DEFAULT_VISIBLE } './chart-view.ts';
#import { merge, when, noop } '../ui/utils.ooc';

chartDefaults = { klines = (Array of), interval = '1m' };

// 静态类名集中声明：模板洞里不能出现未转义的单引号。
ohlcLabelClass = 'text-zinc-600';
toolButtonClass = 'grid h-4 min-w-[18px] place-items-center rounded-sm border border-white/10 px-1 font-mono text-[9px] text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-100';
toolTextClass = 'min-w-[24px] text-center font-mono text-[9px] tabular-nums text-zinc-500';
axisTextClass = 'pointer-events-none absolute right-0 z-10 -translate-y-1/2 whitespace-nowrap px-1 font-mono text-[9px] tabular-nums text-zinc-500';
priceTagBase = 'pointer-events-none absolute right-0 z-20 -translate-y-1/2 whitespace-nowrap rounded-sm px-1 font-mono text-[9px] font-semibold tabular-nums';
priceTagUp = 'bg-emerald-500/90 text-zinc-950';
priceTagDown = 'bg-rose-500/90 text-zinc-950';
timePillClass = 'pointer-events-none absolute bottom-0 z-20 -translate-x-1/2 whitespace-nowrap rounded-sm bg-zinc-700 px-1 font-mono text-[9px] text-zinc-100';
crossLineClass = 'pointer-events-none absolute z-10 border-dashed border-white/30';
upText = 'text-emerald-400';
downText = 'text-rose-400';
hideClass = 'hidden';
showClass = '';

// 一侧颜色：涨绿跌红（本页终端配色，不跟币安走）。
upOfCandle = [c =>
    #guard c;
    (c close) >= (c open)
    #else;
    true
];
candleTextClass = [c =>
    #guard upOfCandle $ c;
    upText
    #else;
    downText
];
wickClass = [up =>
    #guard up;
    'bg-emerald-400/55'
    #else;
    'bg-rose-400/55'
];
bodyClass = [up =>
    #guard up;
    'bg-emerald-400'
    #else;
    'bg-rose-400'
];
volumeClass = [up =>
    #guard up;
    'bg-emerald-400/25'
    #else;
    'bg-rose-400/25'
];
priceTagTone = [up =>
    #guard up;
    priceTagUp
    #else;
    priceTagDown
];
notOf = [value =>
    #guard value;
    false
    #else;
    true
];
showClassOf = [visible =>
    #guard visible;
    showClass
    #else;
    hideClass
];
lastLineClass = [visible =>
    #guard visible;
    'pointer-events-none absolute left-0 right-0 border-t border-dashed border-emerald-400/50'
    #else;
    hideClass
];
cursorOf = [dragging =>
    #guard dragging;
    'cursor-grabbing'
    #else;
    'cursor-crosshair'
];
timeLabelClass = [align =>
    #guard align == 'end';
    'absolute top-0 -translate-x-full whitespace-nowrap'
    #guard align == 'start';
    'absolute top-0 whitespace-nowrap'
    #else;
    'absolute top-0 -translate-x-1/2 whitespace-nowrap'
];
countLabel = [n => '${n}'];

lastCandleOf = [ks =>
    #guard (ks length) > 0;
    ks at (0 - 1)
    #else;
    nil
];
openTextOf = [c =>
    #guard c;
    formatPrice $ (c open)
    #else;
    '--'
];
highTextOf = [c =>
    #guard c;
    formatPrice $ (c high)
    #else;
    '--'
];
lowTextOf = [c =>
    #guard c;
    formatPrice $ (c low)
    #else;
    '--'
];
closeTextOf = [c =>
    #guard c;
    formatPrice $ (c close)
    #else;
    '--'
];

Chart = fc $ [ctx, props =>
    p = merge $ props chartDefaults;
    // 视口：可见根数 + 距最新一根的偏移；0 表示跟随最新。
    zoomCount = bindSignal $ DEFAULT_VISIBLE;
    offset = bindSignal $ 0;
    plotWidth = bindSignal $ 0;
    pointer = bindSignal $ nil;
    dragging = bindSignal $ false;
    dragX = bindRef $ 0;
    dragOffset = bindRef $ 0;
    disconnect = bindRef $ noop;

    totalOf = [ ((p klines $) length)];
    layoutOf = [ chartLayout $ (p klines $) (zoomCount $) (offset $) (plotWidth $)];
    hoverOf = [
        pt = (pointer $);
        #guard pt;
        chartHover $ (layoutOf $) (pt x) (pt y)
        #else;
        nil
    ];
    // 悬停时表头显示光标那根，否则显示最新一根。
    shownOf = [
        h = (hoverOf $);
        #guard h;
        (h candle)
        #else;
        (lastCandleOf $ (p klines $))
    ];
    shownOpen = [ openTextOf $ (shownOf $)];
    shownHigh = [ highTextOf $ (shownOf $)];
    shownLow = [ lowTextOf $ (shownOf $)];
    shownClose = [ closeTextOf $ (shownOf $)];
    shownTag = [ when $ (upOfCandle $ (shownOf $)) upText downText];
    // 悬停那根相对前一根的涨跌幅；不悬停时留空但占位，避免表头抖动。
    shownChange = [
        h = (hoverOf $);
        #guard h;
        (h changeText)
        #else;
        ''
    ];

    // 十字线读不到悬停时给兜底值，避免模板洞抛错。
    hoverXOf = [
        h = (hoverOf $);
        #guard h;
        (h x)
        #else;
        0
    ];
    hoverYOf = [
        h = (hoverOf $);
        #guard h;
        (h y)
        #else;
        0
    ];
    hoverLabelX = [
        h = (hoverOf $);
        #guard h;
        (h labelX)
        #else;
        50
    ];
    hoverPriceText = [
        h = (hoverOf $);
        #guard h;
        formatPrice $ (h price)
        #else;
        '--'
    ];
    hoverTimeText = [
        h = (hoverOf $);
        #guard h;
        (h timeText)
        #else;
        ''
    ];
    hoverShown = [ showClassOf $ ((hoverOf $) != nil)];

    fit = [next =>
        (zoomCount $ (next count));
        (offset $ (next offset))
    ];
    reset = [
        (zoomCount $ DEFAULT_VISIBLE);
        (offset $ 0)
    ];
    zoomBy = [factor => fit $ (zoomByStep $ (totalOf $) (zoomCount $) (offset $) factor)];

    onDown = [e =>
        (dragging $ true);
        (dragX $ (e clientX));
        (dragOffset $ (offset $));
        capturePointer $ e
    ];
    onDragMove = [e =>
        #guard (dragging $);
        fit $ (panByPixels $ (totalOf $) (zoomCount $) (dragOffset $) ((e clientX) - (dragX $)) (plotWidth $))
    ];
    onUp = [e =>
        (dragging $ false);
        releasePointer $ e
    ];

    (dom div { className = 'flex h-full flex-col' }
        // 表头：光标所在 K 线（或最新一根）的 OHLC + 缩放控件
        (dom div {
            className = 'flex h-8 shrink-0 items-center gap-3 border-b border-white/5 px-3 font-mono text-[10px] tabular-nums'
        }
            (dom span { className = ohlcLabelClass } 'O'
                (dom span { className => 'ml-1 ${shownTag $}' } (text $ [shownOpen $]))
            )
            (dom span { className = ohlcLabelClass } 'H'
                (dom span { className => 'ml-1 ${shownTag $}' } (text $ [shownHigh $]))
            )
            (dom span { className = ohlcLabelClass } 'L'
                (dom span { className => 'ml-1 ${shownTag $}' } (text $ [shownLow $]))
            )
            (dom span { className = ohlcLabelClass } 'C'
                (dom span { className => 'ml-1 ${shownTag $}' } (text $ [shownClose $]))
            )
            (dom span { className => 'min-w-[44px] tabular-nums ${shownTag $}' }
                (text $ [shownChange $])
            )

            (dom div { className = 'ml-auto flex shrink-0 items-center gap-1' }
                (dom button {
                    type = 'button',
                    title = 'Zoom out',
                    className = toolButtonClass,
                    onClick(e){ zoomBy $ 1.25 }
                } '-')
                (dom span { className = toolTextClass } (text $ [countLabel $ (zoomCount $)]))
                (dom button {
                    type = 'button',
                    title = 'Zoom in',
                    className = toolButtonClass,
                    onClick(e){ zoomBy $ 0.8 }
                } '+')
                (dom button {
                    type = 'button',
                    title = 'Back to latest',
                    className = toolButtonClass,
                    onClick(e){ reset $ }
                } 'RESET')
                (dom span { className = 'ml-1 text-zinc-600' } (text $ (p interval)))
            )
        )

        (dom div { className = 'relative min-h-0 flex-1 overflow-hidden' }
            // 绘图区：右侧让出价格轴，底部让出时间轴
            (dom div {
                className => 'absolute left-0 right-16 top-0 bottom-4 select-none touch-none ${cursorOf $ (dragging $)}',
                plugin(el){ disconnect $ (watchSize $ el [s => plotWidth $ (s width)]) },
                willRemove(el){ ((disconnect $) $) },
                onWheel(e){ fit $ (zoomByEvent $ (totalOf $) (zoomCount $) (offset $) e) },
                onPointerDown(e){ onDown $ e },
                onPointerMove(e){
                    (pointer $ (pointerRatio $ e));
                    onDragMove $ e
                },
                onPointerUp(e){ onUp $ e },
                onPointerLeave(e){ pointer $ nil },
                onDblClick(e){ reset $ }
            }
                // 价格网格
                (forEach $ {
                    forEach(block){ ((layoutOf $) priceTicks) forEach [t, i => block $ (t value) t] },
                    creater(ic, et, key){
                        (dom div {
                            className = 'pointer-events-none absolute left-0 right-0 border-t border-white/[0.045]',
                            s_top => '${et value/ top}%'
                        }) $ ic
                    }
                })

                // 成交量区的上边界（与 chart-view.ts 的 VOLUME_TOP = 82 对齐）
                (dom div {
                    className = 'pointer-events-none absolute left-0 right-0 border-t border-white/[0.07]',
                    s_top = '82%'
                })

                // 蜡烛 + 成交量柱
                (forEach $ {
                    forEach(block){ ((layoutOf $) boxes) forEach [b, i => block $ (b key) b] },
                    creater(ic, et, key){
                        (dom div {
                            className = 'pointer-events-none absolute top-0 h-full',
                            s_left => '${et value/ left}%',
                            s_width => '${et value/ width}%'
                        }
                            (dom div {
                                className => 'absolute w-full ${wickClass $ (et value/ up)}',
                                s_top => '${et value/ wickTop}%',
                                s_height => '${et value/ wickHeight}%'
                            })
                            (dom div {
                                className => 'absolute w-full ${bodyClass $ (et value/ up)}',
                                s_top => '${et value/ bodyTop}%',
                                s_height => '${et value/ bodyHeight}%'
                            })
                            (dom div {
                                className => 'absolute w-full ${volumeClass $ (et value/ up)}',
                                s_top => '${et value/ volumeTop}%',
                                s_height => '${et value/ volumeHeight}%'
                            })
                        ) $ ic
                    }
                })

                // 最新价虚线
                (dom div {
                    className => (lastLineClass $ ((layoutOf $) showLast)),
                    s_top => '${(layoutOf $) lastTop}%'
                })

                // 十字线
                (dom div {
                    className => '${crossLineClass} top-0 bottom-0 border-l ${hoverShown $}',
                    s_left => '${hoverXOf $}%'
                })
                (dom div {
                    className => '${crossLineClass} left-0 right-0 border-t ${hoverShown $}',
                    s_top => '${hoverYOf $}%'
                })

                (dom div {
                    className => 'pointer-events-none absolute inset-0 grid place-items-center font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600 ${showClassOf $ (notOf $ ((layoutOf $) hasData))}'
                } 'Waiting for candles')
            )

            // 右侧价格轴：刻度 + 最新价标签 + 十字线价格
            (dom div {
                className = 'pointer-events-none absolute right-0 top-0 bottom-4 w-16 border-l border-white/10 font-mono text-[9px] tabular-nums'
            }
                (forEach $ {
                    forEach(block){ ((layoutOf $) priceTicks) forEach [t, i => block $ (t value) t] },
                    creater(ic, et, key){
                        (dom span { className = axisTextClass, s_top => '${et value/ top}%' }
                            (text $ [formatAxisPrice $ (et value/ value)])
                        ) $ ic
                    }
                })
                (dom span {
                    className => '${priceTagBase} ${priceTagTone $ ((layoutOf $) showLast)} ${showClassOf $ ((layoutOf $) showLast)}',
                    s_top => '${(layoutOf $) lastTop}%'
                }
                    (text $ [formatPrice $ ((layoutOf $) last)])
                )
                (dom span {
                    className => '${priceTagBase} bg-zinc-700 text-zinc-100 ${hoverShown $}',
                    s_top => '${hoverYOf $}%'
                }
                    (text $ [hoverPriceText $])
                )
            )

            // 底部时间轴：按宽度决定标签个数
            (dom div {
                className = 'pointer-events-none absolute bottom-0 left-0 right-16 h-4 overflow-hidden font-mono text-[9px] tabular-nums text-zinc-500'
            }
                (forEach $ {
                    forEach(block){ ((layoutOf $) timeTicks) forEach [t, i => block $ i t] },
                    creater(ic, et, key){
                        (dom span {
                            className => (timeLabelClass $ (et value/ align)),
                            s_left => '${et value/ left}%'
                        }
                            (text $ (et value/ text))
                        ) $ ic
                    }
                })
                (dom span {
                    className => '${timePillClass} ${hoverShown $}',
                    s_left => '${hoverLabelX $}%'
                }
                    (text $ [hoverTimeText $])
                )
            )
        )
    ) $ ctx
];

Chart
