// depth-chart.ooc — 累计深度图：共享价格轴与累计量轴、固定中间价，带刻度与悬停提示。
// 几何计算在 depth.ts，组件只负责 SVG 绘制、缩放控件、刻度与 tooltip。
#import { dom, text, fc, svg, forEach, bindSignal, bindRef } '../bridge.ts';
#import { depthGeometry, depthXTickCount, depthHoverPair, pointerRatioAt, zoomDepthAt, zoomDepthBy, formatDepthZoom, formatDepthRange, formatSignedDepthRange } './depth.ts';
#import { formatPrice, formatQty, formatCompact } './market.ts';
#import { merge, when, noop } '../ui/utils.ooc';
#import { watchSize } './measure.ts';

depthDefaults = { depth = nil };

zoomButtonClass = 'pointer-events-auto grid h-5 min-w-5 place-items-center rounded-sm border border-white/10 px-1 font-mono text-[9px] text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-100';
emptyStateClass = [hasData =>
    #guard hasData;
    'hidden'
    #else;
    ''
];
xTickClass = [left =>
    #guard left == 0;
    'absolute left-0 top-1/2 -translate-y-1/2 whitespace-nowrap'
    #else;
    when $ (left == 100)
        'absolute top-1/2 -translate-x-full -translate-y-1/2 whitespace-nowrap'
        'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap'
];
// 展开时覆盖整个视口，给小面板一个 Binance 式的大图视图。
rootClass = [expanded =>
    when $ expanded
        'fixed inset-3 z-50 flex min-h-0 flex-col rounded-lg border border-white/10 bg-[#070b0f] p-2 shadow-2xl'
        'relative flex h-full min-h-0 flex-col'
];
expandLabel = [expanded =>
    when $ expanded 'CLOSE' 'FULL'
];
axisTextClass = [expanded =>
    when $ expanded 'text-[10px]' 'text-[8px]'
];
yTickClass = [top =>
    #guard top == 0;
    'absolute right-0 top-0'
    #else;
    when $ (top == 100)
        'absolute right-0 -translate-y-full'
        'absolute right-0 -translate-y-1/2'
];
tooltipTextClass = [expanded =>
    when $ expanded 'text-[10px]' 'text-[9px]'
];
pairLeft = [hp =>
    #guard hp;
    hp left
    #else;
    nil
];
pairRight = [hp =>
    #guard hp;
    hp right
    #else;
    nil
];
pairWide = [hp =>
    #guard hp;
    hp wide
    #else;
    false
];
pairMask = [hp =>
    #guard hp;
    'width:${hp maskWidth}%;transition:width 120ms ease'
    #else;
    'width:0%;transition:width 120ms ease'
];
hoverX = [h =>
    #guard h;
    h x
    #else;
    0
];
hoverFade = [h =>
    #guard h;
    1
    #else;
    0
];
hoverSideText = [h =>
    #guard h;
    when $ ((h side) == 'bid') 'BID' 'ASK'
    #else;
    ''
];
hoverSideClass = [h =>
    #guard h;
    when $ ((h side) == 'bid') 'text-emerald-300' 'text-rose-300'
    #else;
    'text-zinc-500'
];
hoverRangeText = [h =>
    #guard h;
    formatSignedDepthRange $ (h rangePct)
    #else;
    '--'
];
rangeTone = [value =>
    #guard value < 0;
    'text-rose-300'
    #guard value > 0;
    'text-emerald-300'
    #else;
    'text-zinc-400'
];
hoverRangeClass = [h =>
    #guard h;
    rangeTone $ (h rangePct)
    #else;
    'text-zinc-500'
];
hoverPriceText = [h =>
    #guard h;
    formatPrice $ (h price)
    #else;
    '--'
];
hoverTotalText = [h =>
    #guard h;
    formatQty $ (h total)
    #else;
    '--'
];
// 累计名义金额：和盘口 Total 同一口径，便于判断「这段深度值多少钱」。
hoverValueText = [h =>
    #guard h;
    formatCompact $ (h notional)
    #else;
    '--'
];
tipYOffset = [value =>
    #guard value < 26;
    'translateY(6px)'
    #guard value > 74;
    'translateY(calc(-100% - 6px))'
    #else;
    'translateY(-50%)'
];
tipYStyle = [h =>
    #guard h;
    'top:${h y}%;transform:${tipYOffset $ (h y)}'
    #else;
    'display:none'
];
tipLeftStyle = [h, wide =>
    #guard h;
    when $ wide
        'left:calc(${(h x) div 10}% + 8px);${tipYStyle $ h}'
        'right:calc(${h tipRight}% + 8px);${tipYStyle $ h}'
    #else;
    'display:none'
];
tipRightStyle = [h, wide =>
    #guard h;
    when $ wide
        'right:calc(${h tipRight}% + 8px);${tipYStyle $ h}'
        'left:calc(${(h x) div 10}% + 8px);${tipYStyle $ h}'
    #else;
    'display:none'
];
dotStyle = [h =>
    #guard h;
    'left:${(h x) div 10}%;top:${(h y)}%'
    #else;
    'display:none'
];

DepthChart = fc $ [ctx, props =>
    p = merge $ props depthDefaults;
    zoom = bindSignal $ 1;
    expanded = bindSignal $ false;
    hoverRatio = bindSignal $ nil;
    // 绘图宽度决定 X 轴放几个价格标签；窄面板不再硬塞 9 个。
    plotWidth = bindSignal $ 0;
    plotDisconnect = bindRef $ noop;
    // 只保存光标比例，数据刷新时按最新盘口重算，避免圆点与曲线错位。
    // 同时算出镜像点：左侧 BID、右侧 ASK，供双 tooltip 与对称遮罩使用。
    hoverPair = [depthHoverPair $ (p depth $) (zoom $) (hoverRatio $)];
    hoverLeft = [pairLeft $ (hoverPair $)];
    hoverRight = [pairRight $ (hoverPair $)];
    reset = [zoom $ 1];
    zoomBy = [factor => zoom $ (zoomDepthBy $ (zoom $) factor)];
    geoOf = [d, z => depthGeometry $ d z (depthXTickCount $ (plotWidth $))];

    (dom div { className => (rootClass $ (expanded $)) }
        (dom div { className = 'flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2 pt-1' }
            (dom div { className = 'flex min-w-0 items-center gap-1.5 font-mono text-[9px] tracking-wide' }
                (dom span { className = 'h-1.5 w-3 rounded-sm bg-emerald-400/70' })
                (dom span { className = 'text-emerald-300/90' } 'BID')
                (dom span { className = 'text-zinc-600' }
                    (text $ [formatQty $ ((geoOf $ (p depth $) (zoom $)) bidMax)])
                )
                (dom span { className = 'ml-1 h-1.5 w-3 rounded-sm bg-rose-400/70' })
                (dom span { className = 'text-rose-300/90' } 'ASK')
                (dom span { className = 'text-zinc-600' }
                    (text $ [formatQty $ ((geoOf $ (p depth $) (zoom $)) askMax)])
                )
                (dom span { className = 'ml-1 text-zinc-600' } '价差幅度')
                (dom span { className = 'text-zinc-400' }
                    (text $ [formatDepthRange $ ((geoOf $ (p depth $) (zoom $)) rangePct)])
                )
            )
            (dom div { className = 'ml-auto flex shrink-0 items-center gap-1' }
                (dom button { type = 'button', className = zoomButtonClass, onClick(e){ zoomBy $ 0.8 } } '-')
                (dom span { className = 'w-9 text-center font-mono text-[9px] tabular-nums text-zinc-500' }
                    (text $ [formatDepthZoom $ (zoom $)])
                )
                (dom button { type = 'button', className = zoomButtonClass, onClick(e){ zoomBy $ 1.25 } } '+')
                (dom button { type = 'button', className = zoomButtonClass, onClick(e){ reset $ } } 'RESET')
                (dom button {
                    type = 'button',
                    className = zoomButtonClass,
                    title => (when $ (expanded $) 'Close fullscreen' 'Expand depth chart'),
                    onClick(e){ expanded $ (when $ (expanded $) false true) }
                }
                    (text $ [(expandLabel $ (expanded $))])
                )
            )
        )

        (dom div {
            className = 'relative min-h-0 flex-1 select-none overflow-hidden',
            onWheel(e){ zoom $ (zoomDepthAt $ e (zoom $)) },
            onDblClick(e){ reset $ }
        }
            // 绘图区：右侧留累计量刻度，底部留价格刻度；光标比例也按绘图区计算。
            (dom div {
                className = 'absolute left-0 right-10 top-0 bottom-4',
                plugin(el){ plotDisconnect $ (watchSize $ el [s => plotWidth $ (s width)]) },
                willRemove(el){ ((plotDisconnect $) $) },
                onPointerMove(e){ hoverRatio $ (pointerRatioAt $ e) },
                onPointerLeave(e){ hoverRatio $ nil }
            }
                (svg svg {
                    className = 'absolute inset-0 h-full w-full',
                    viewBox = '0 0 1000 100',
                    preserveAspectRatio = 'none'
                }
                    (svg path {
                        d => ((geoOf $ (p depth $) (zoom $)) bidArea),
                        fill = 'rgba(16,185,129,0.16)'
                    })
                    (svg path {
                        d => ((geoOf $ (p depth $) (zoom $)) askArea),
                        fill = 'rgba(244,63,94,0.15)'
                    })
                    (svg path {
                        d => ((geoOf $ (p depth $) (zoom $)) bidLine),
                        fill = 'none',
                        stroke = 'rgba(52,211,153,0.95)',
                        strokeWidth = 1.5,
                        strokeLinejoin = 'round',
                        vectorEffect = 'non-scaling-stroke'
                    })
                    (svg path {
                        d => ((geoOf $ (p depth $) (zoom $)) askLine),
                        fill = 'none',
                        stroke = 'rgba(251,113,133,0.95)',
                        strokeWidth = 1.5,
                        strokeLinejoin = 'round',
                        vectorEffect = 'non-scaling-stroke'
                    })
                    // 对称遮罩：只压暗两条光标线外侧，中间带保持高亮。
                    (svg rect {
                        x = 0,
                        y = 0,
                        width => (hoverX $ (hoverLeft $)),
                        height = 100,
                        fill = 'rgba(2,6,10,0.45)',
                        opacity => (hoverFade $ (hoverLeft $))
                    })
                    (svg rect {
                        x => (hoverX $ (hoverRight $)),
                        y = 0,
                        width => (1000 - (hoverX $ (hoverRight $))),
                        height = 100,
                        fill = 'rgba(2,6,10,0.45)',
                        opacity => (hoverFade $ (hoverRight $))
                    })
                    (svg line {
                        x1 => ((geoOf $ (p depth $) (zoom $)) midX),
                        y1 = 0,
                        x2 => ((geoOf $ (p depth $) (zoom $)) midX),
                        y2 = 100,
                        stroke = 'rgba(255,255,255,0.18)',
                        strokeWidth = 1,
                        strokeDasharray = '3 5',
                        vectorEffect = 'non-scaling-stroke'
                    })
                    (svg line {
                        x1 => (hoverX $ (hoverLeft $)),
                        y1 = 0,
                        x2 => (hoverX $ (hoverLeft $)),
                        y2 = 100,
                        stroke = 'rgba(255,255,255,0.35)',
                        strokeWidth = 1,
                        strokeDasharray = '3 4',
                        opacity => (hoverFade $ (hoverLeft $)),
                        vectorEffect = 'non-scaling-stroke'
                    })
                    (svg line {
                        x1 => (hoverX $ (hoverRight $)),
                        y1 = 0,
                        x2 => (hoverX $ (hoverRight $)),
                        y2 = 100,
                        stroke = 'rgba(255,255,255,0.35)',
                        strokeWidth = 1,
                        strokeDasharray = '3 4',
                        opacity => (hoverFade $ (hoverRight $)),
                        vectorEffect = 'non-scaling-stroke'
                    })
                )

                // 横向网格：跟随共享累计量轴的刻度。
                (forEach $ {
                    forEach(block){ ((geoOf $ (p depth $) (zoom $)) yTicks) forEach [t, i => block $ i t] },
                    creater(ic, et, key){
                        (dom div {
                            className = 'pointer-events-none absolute left-0 right-0 border-t border-white/[0.045]',
                            s_top => '${et value/ top}%'
                        }) $ ic
                    }
                })

                (dom span {
                    className = 'pointer-events-none absolute z-20 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#0b1117] bg-emerald-300',
                    style => (dotStyle $ (hoverLeft $))
                })
                (dom span {
                    className = 'pointer-events-none absolute z-20 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#0b1117] bg-rose-300',
                    style => (dotStyle $ (hoverRight $))
                })

                (dom div {
                    className => 'pointer-events-none absolute z-20 min-w-[7.5rem] rounded border border-white/10 bg-[#0b1117]/95 px-1.5 py-1 font-mono leading-tight shadow-lg ${tooltipTextClass $ (expanded $)}',
                    style => (tipLeftStyle $ (hoverLeft $) (pairWide $ (hoverPair $)))
                }
                    (dom div { className = 'flex items-center justify-between gap-2' }
                        (dom span { className => (hoverSideClass $ (hoverLeft $)) }
                            (text $ [(hoverSideText $ (hoverLeft $))])
                        )
                        (dom span { className => 'tabular-nums ${hoverRangeClass $ (hoverLeft $)}' }
                            (text $ [(hoverRangeText $ (hoverLeft $))])
                        )
                    )
                    (dom div { className = 'mt-0.5 flex items-center justify-between gap-2' }
                        (dom span { className = 'text-zinc-500' } 'Price')
                        (dom span { className = 'tabular-nums text-zinc-100' }
                            (text $ [(hoverPriceText $ (hoverLeft $))])
                        )
                    )
                    (dom div { className = 'flex items-center justify-between gap-2' }
                        (dom span { className = 'text-zinc-500' } 'Amount')
                        (dom span { className = 'tabular-nums text-zinc-200' }
                            (text $ [(hoverTotalText $ (hoverLeft $))])
                        )
                    )
                    (dom div { className = 'flex items-center justify-between gap-2' }
                        (dom span { className = 'text-zinc-500' } 'Value')
                        (dom span { className = 'tabular-nums text-zinc-300' }
                            (text $ [(hoverValueText $ (hoverLeft $))])
                        )
                    )
                )

                (dom div {
                    className => 'pointer-events-none absolute z-20 min-w-[7.5rem] rounded border border-white/10 bg-[#0b1117]/95 px-1.5 py-1 font-mono leading-tight shadow-lg ${tooltipTextClass $ (expanded $)}',
                    style => (tipRightStyle $ (hoverRight $) (pairWide $ (hoverPair $)))
                }
                    (dom div { className = 'flex items-center justify-between gap-2' }
                        (dom span { className => (hoverSideClass $ (hoverRight $)) }
                            (text $ [(hoverSideText $ (hoverRight $))])
                        )
                        (dom span { className => 'tabular-nums ${hoverRangeClass $ (hoverRight $)}' }
                            (text $ [(hoverRangeText $ (hoverRight $))])
                        )
                    )
                    (dom div { className = 'mt-0.5 flex items-center justify-between gap-2' }
                        (dom span { className = 'text-zinc-500' } 'Price')
                        (dom span { className = 'tabular-nums text-zinc-100' }
                            (text $ [(hoverPriceText $ (hoverRight $))])
                        )
                    )
                    (dom div { className = 'flex items-center justify-between gap-2' }
                        (dom span { className = 'text-zinc-500' } 'Amount')
                        (dom span { className = 'tabular-nums text-zinc-200' }
                            (text $ [(hoverTotalText $ (hoverRight $))])
                        )
                    )
                    (dom div { className = 'flex items-center justify-between gap-2' }
                        (dom span { className = 'text-zinc-500' } 'Value')
                        (dom span { className = 'tabular-nums text-zinc-300' }
                            (text $ [(hoverValueText $ (hoverRight $))])
                        )
                    )
                )

                (dom div {
                    className => 'pointer-events-none absolute inset-0 grid place-items-center font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600 ${emptyStateClass $ ((geoOf $ (p depth $) (zoom $)) hasData)}'
                } 'Waiting for depth')
            )

            // 右侧累计量刻度：买卖共用一套，直接体现两侧深度差。
            (dom div {
                className => 'pointer-events-none absolute bottom-4 right-0 top-0 w-10 border-l border-white/10 pl-1 pr-0.5 font-mono leading-none tabular-nums text-zinc-500 ${axisTextClass $ (expanded $)}'
            }
                (forEach $ {
                    forEach(block){ ((geoOf $ (p depth $) (zoom $)) yTicks) forEach [t, i => block $ i t] },
                    creater(ic, et, key){
                        (dom span {
                            className => '${yTickClass $ (et value/ top)} whitespace-nowrap',
                            s_top => '${et value/ top}%'
                        }
                            (text $ [formatCompact $ (et value/ value)])
                        ) $ ic
                    }
                })
            )

            // 底部价格刻度：横轴始终以中间价居中，缩放时只改跨度。
            (dom div {
                className => 'pointer-events-none absolute bottom-0 left-0 right-10 h-4 overflow-hidden font-mono tabular-nums text-zinc-500 ${axisTextClass $ (expanded $)}'
            }
                (forEach $ {
                    forEach(block){ ((geoOf $ (p depth $) (zoom $)) xTicks) forEach [t, i => block $ i t] },
                    creater(ic, et, key){
                        (dom span {
                            className => (xTickClass $ (et value/ left)),
                            s_left => '${et value/ left}%'
                        }
                            (text $ [formatPrice $ (et value/ value)])
                        ) $ ic
                    }
                })
            )
        )
    ) $ ctx
];

DepthChart
