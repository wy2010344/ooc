// trades.ooc — 最近成交：逐笔价格、数量与时间，按主动方向着色。
#import { dom, text, fc, forEach } '../bridge.ts';
#import { formatPrice, formatQty, formatTime } './market.ts';
#import { merge } '../ui/utils.ooc';

tradesDefaults = { trades = (Array of) };

tradeClass = [buyerMaker =>
    #guard buyerMaker;
    'text-rose-400'
    #else;
    'text-emerald-400'
];

Trades = fc $ [ctx, props =>
    p = merge $ props tradesDefaults;
    (dom div { className = 'flex h-full flex-col' }
        (dom div {
            className = 'grid shrink-0 grid-cols-[1fr_1fr_64px] gap-2 border-b border-white/5 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-zinc-600'
        }
            (dom span {} 'Price')
            (dom span { className = 'text-right' } 'Amount')
            (dom span { className = 'text-right' } 'Time')
        )
        (dom div { className = 'min-h-0 flex-1 overflow-y-auto' }
            (forEach $ {
                forEach(block){ (p trades $) forEach [t, i => block $ (t id) t] },
                creater(ic, et, key){
                    (dom div {
                        className = 'grid grid-cols-[1fr_1fr_64px] gap-2 border-b border-white/[0.025] px-3 py-[3px] font-mono text-[10px] tabular-nums'
                    }
                        (dom span {
                            className => '${tradeClass $ (et value/ buyerMaker)}'
                        } (text $ [formatPrice $ (et value/ price)]))
                        (dom span { className = 'text-right text-zinc-400' }
                            (text $ [formatQty $ (et value/ qty)])
                        )
                        (dom span { className = 'text-right text-zinc-600' }
                            (text $ [formatTime $ (et value/ time)])
                        )
                    ) $ ic
                }
            })
        )
    ) $ ctx
];

Trades
