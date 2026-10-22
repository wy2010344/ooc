// ticket.ooc — 模拟下单窗格（Paper）：只做 UI 演示，不接任何私有/交易接口。
#import { dom, text, fc, bindSignal } '../bridge.ts';
#import { Input } '../ui/input.ooc';
#import { formatPrice, formatQty } './market.ts';
#import { merge } '../ui/utils.ooc';

ticketDefaults = { ticker = nil, price = nil };
BALANCE = 10000;

// 盘口点价后带上来的限价；为空时回落到最新成交价。
rawPrice = [t =>
    #guard t;
    (t last)
    #else;
    0
];
priceOf = [t, px =>
    #guard px;
    px
    #else;
    rawPrice $ t
];
priceText = [t, px =>
    v = (priceOf $ t px);
    #guard v > 0;
    formatPrice $ v
    #else;
    '--'
];
amountNumber = [v =>
    n = Number $ v;
    #guard n;
    n
    #else;
    0
];
totalText = [t, px, amount =>
    total = (priceOf $ t px) * (amountNumber $ amount);
    #guard total > 0;
    formatPrice $ total
    #else;
    '0.00'
];
qtyText = [t, px, amount =>
    p = (priceOf $ t px);
    #guard p > 0;
    formatQty $ ((amountNumber $ amount) div p)
    #else;
    '0'
];
tradeLabel = [side =>
    #guard side == 'buy';
    '买入'
    #else;
    '卖出'
];
noteText = [t, px, amount, side =>
    '模拟${tradeLabel $ side} ${qtyText $ t px amount} — 未提交交易所'
];
clearPriceClass = 'rounded-sm border border-white/10 px-1 font-mono text-[9px] text-zinc-500 transition-colors hover:border-white/25 hover:text-zinc-200';
hideUnless = [visible =>
    #guard visible;
    ''
    #else;
    'hidden'
];
buyTabClass = [side =>
    #guard side == 'buy';
    'bg-emerald-500 text-zinc-950'
    #else;
    'text-zinc-500 hover:bg-white/5'
];
sellTabClass = [side =>
    #guard side == 'sell';
    'bg-rose-500 text-zinc-950'
    #else;
    'text-zinc-500 hover:bg-white/5'
];
submitClass = [side =>
    #guard side == 'buy';
    'bg-emerald-500 text-zinc-950'
    #else;
    'bg-rose-500 text-zinc-950'
];

Ticket = fc $ [ctx, props =>
    p = merge $ props ticketDefaults;
    side = bindSignal $ 'buy';
    amount = bindSignal $ '0.05';
    note = bindSignal $ '';
    // 价格来源：盘口点价优先，否则跟随最新价。
    pxOf = [
        s = (p price);
        #guard s;
        (s $)
        #else;
        nil
    ];
    clearPrice = [e =>
        source = (p price);
        #guard source;
        (source $ nil)
        #else;
        nil
    ];

    setPct = [ratio =>
        price = (priceOf $ (p ticker $) (pxOf $));
        #guard price > 0;
        usd = BALANCE * ratio;
        amount $ ((usd div price) toFixed 6);
        note $ ''
        #else;
        note $ '等待行情…'
    ];
    submit = [e =>
        note $ (noteText $ (p ticker $) (pxOf $) (amount $) (side $))
    ];

    (dom div { className = 'flex h-full flex-col' }
        (dom div { className = 'grid shrink-0 grid-cols-2 gap-1 border-b border-white/5 p-2' }
            (dom button {
                type = 'button',
                className => 'rounded-sm py-1.5 text-[11px] font-semibold transition-colors ${buyTabClass $ (side $)}',
                onClick(e){ side $ 'buy'; note $ '' }
            } '买入 / Buy')
            (dom button {
                type = 'button',
                className => 'rounded-sm py-1.5 text-[11px] font-semibold transition-colors ${sellTabClass $ (side $)}',
                onClick(e){ side $ 'sell'; note $ '' }
            } '卖出 / Sell')
        )

        (dom div { className = 'flex flex-col gap-2 p-3' }
            (dom div { className = 'flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-zinc-600' }
                (dom span {} 'Limit price')
                (dom div { className = 'flex items-center gap-1.5' }
                    (dom span { className = 'font-mono text-[11px] normal-case tracking-normal text-zinc-300' }
                        (text $ [priceText $ (p ticker $) (pxOf $)])
                    )
                    (dom button {
                        type = 'button',
                        title = 'Follow last price',
                        className => '${clearPriceClass} ${hideUnless $ ((pxOf $) != nil)}',
                        onClick(e){ clearPrice $ e }
                    } '×')
                )
            )
            (dom div { className = 'flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-zinc-600' }
                (dom span {} 'Amount (USDT)')
                (dom span { className = 'font-mono text-[11px] normal-case tracking-normal text-zinc-300' }
                    (text $ [totalText $ (p ticker $) (pxOf $) (amount $)])
                )
            )

            (dom div { className = 'rounded-sm border border-white/8 bg-black/20 px-2 py-1.5' }
                (Input $ {
                    className = 'h-7 border-0 bg-transparent px-0 text-right font-mono text-sm shadow-none focus-visible:ring-0',
                    placeholder = '0.05',
                    getValue = amount,
                    setValue = [v => amount $ v]
                })
            )

            (dom div { className = 'grid grid-cols-4 gap-1' }
                (dom button {
                    type = 'button',
                    className = 'rounded-sm border border-white/6 py-1 font-mono text-[9px] text-zinc-500 hover:border-white/20 hover:text-zinc-200',
                    onClick(e){ setPct $ 0.25 }
                } '25%')
                (dom button {
                    type = 'button',
                    className = 'rounded-sm border border-white/6 py-1 font-mono text-[9px] text-zinc-500 hover:border-white/20 hover:text-zinc-200',
                    onClick(e){ setPct $ 0.5 }
                } '50%')
                (dom button {
                    type = 'button',
                    className = 'rounded-sm border border-white/6 py-1 font-mono text-[9px] text-zinc-500 hover:border-white/20 hover:text-zinc-200',
                    onClick(e){ setPct $ 0.75 }
                } '75%')
                (dom button {
                    type = 'button',
                    className = 'rounded-sm border border-white/6 py-1 font-mono text-[9px] text-zinc-500 hover:border-white/20 hover:text-zinc-200',
                    onClick(e){ setPct $ 1 }
                } 'MAX')
            )

            (dom div { className = 'flex items-center justify-between text-[10px] text-zinc-600' }
                (dom span {} 'Est. qty')
                (dom span { className = 'font-mono text-zinc-400' } (text $ [qtyText $ (p ticker $) (pxOf $) (amount $)]))
            )

            (dom button {
                type = 'button',
                className => 'mt-1 rounded-sm py-2 text-[11px] font-semibold transition-opacity hover:opacity-90 ${submitClass $ (side $)}',
                onClick(e){ submit $ e }
            }
                (text $ [tradeLabel $ (side $)])
            )

            (dom p { className = 'min-h-8 text-[9px] leading-4 text-zinc-600' } (text $ note))
        )
    ) $ ctx
];

Ticket
