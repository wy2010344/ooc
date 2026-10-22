// watchlist.ooc — 自选列表：价格与 24h 涨跌，点击切换当前交易对。
#import { dom, text, fc, forEach } '../bridge.ts';
#import { formatPrice, formatPercent, formatCompact } './market.ts';
#import { merge, noop } '../ui/utils.ooc';

watchDefaults = { tickers = (Array of), active = '', onPick = noop };

rowClass = [active, current =>
    #guard active == current;
    'bg-emerald-400/[0.06]'
    #else;
    ''
];
changeClass = [v =>
    #guard v >= 0;
    'text-emerald-400'
    #else;
    'text-rose-400'
];

Watchlist = fc $ [ctx, props =>
    p = merge $ props watchDefaults;
    (dom div { className = 'flex h-full flex-col' }
        (dom div {
            className = 'grid shrink-0 grid-cols-[1fr_auto_58px] gap-2 border-b border-white/5 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-zinc-600'
        }
            (dom span {} 'Symbol')
            (dom span { className = 'text-right' } 'Last')
            (dom span { className = 'text-right' } '24h')
        )
        (dom div { className = 'min-h-0 flex-1 overflow-y-auto' }
            (forEach $ {
                forEach(block){ (p tickers $) forEach [t, i => block $ (t symbol) t] },
                creater(ic, et, key){
                    (dom button {
                        type = 'button',
                        className => 'grid w-full grid-cols-[1fr_auto_58px] items-center gap-2 border-b border-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/[0.04] ${rowClass $ (et value/ symbol) (p active $)}',
                        onClick(e){ (p onPick) $ (et value/ symbol) }
                    }
                        (dom div { className = 'flex min-w-0 flex-col' }
                            (dom span { className = 'truncate text-[11px] font-medium text-zinc-200' }
                                (text $ [(et value/ symbol)])
                            )
                            (dom span { className = 'text-[9px] text-zinc-600' }
                                (text $ ['Vol ${formatCompact $ (et value/ quoteVolume)}'])
                            )
                        )
                        (dom span { className = 'text-right font-mono text-[11px] tabular-nums text-zinc-200' }
                            (text $ [formatPrice $ (et value/ last)])
                        )
                        (dom span {
                            className => 'text-right font-mono text-[10px] tabular-nums ${changeClass $ (et value/ changePercent)}'
                        }
                            (text $ [formatPercent $ (et value/ changePercent)])
                        )
                    ) $ ic
                }
            })
        )
    ) $ ctx
];

Watchlist
