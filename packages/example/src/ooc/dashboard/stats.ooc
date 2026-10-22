// stats.ooc — 交易对概览：24h 高低、成交量、买一/卖一与区间位置。
#import { dom, text, fc, js } '../bridge.ts';
#import { formatPrice, formatCompact, formatPercent } './market.ts';
#import { merge, when } '../ui/utils.ooc';

statsDefaults = { ticker = nil };

pick = [t, field =>
    #guard t;
    js send t field
    #else;
    nil
];

priceOf = [t, field =>
    v = (pick $ t field);
    formatPrice $ v
];
compactOf = [t, field =>
    v = (pick $ t field);
    formatCompact $ v
];
percentOf = [t =>
    v = (pick $ t 'changePercent');
    formatPercent $ v
];
rangePercent = [t =>
    #guard t;
    high = (t high);
    low = (t low);
    last = (t last);
    span = high - low;
    when $ (span > 0) (((last - low) div span) * 100) 50
];
rangeText = [t =>
    #guard t;
    p = (rangePercent $ t);
    '${p toFixed 1}%'
    #else;
    '--'
];
rangeWidth = [t =>
    #guard t;
    (rangePercent $ t)
    #else;
    50
];
changeValue = [t =>
    #guard t;
    t changePercent
    #else;
    0
];
changeTone = [t =>
    #guard (changeValue $ t) >= 0;
    'text-emerald-400'
    #else;
    'text-rose-400'
];

StatRow = fc $ [ctx, label, value, tone =>
    (dom div { className = 'flex items-center justify-between gap-3 border-b border-white/[0.03] px-3 py-2' }
        (dom span { className = 'text-[10px] uppercase tracking-[0.12em] text-zinc-600' } (text $ label))
        (dom span { className => 'font-mono text-[11px] tabular-nums ${tone}' } (text $ value))
    ) $ ctx
];

Stats = fc $ [ctx, props =>
    p = merge $ props statsDefaults;
    (dom div { className = 'flex h-full flex-col' }
        (dom div { className = 'border-b border-white/5 px-3 py-3' }
            (dom div { className = 'flex items-baseline justify-between gap-2' }
                (dom span { className = 'text-[10px] uppercase tracking-[0.18em] text-zinc-500' } '24h Change')
                (dom span {
                    className => 'font-mono text-sm font-semibold tabular-nums ${changeTone $ (p ticker $)}'
                } (text $ [percentOf $ (p ticker $)]))
            )
            (dom div { className = 'mt-3 h-1 overflow-hidden rounded-full bg-white/6' }
                (dom div {
                    className = 'h-full rounded-full bg-linear-to-r from-rose-400 via-amber-300 to-emerald-400',
                    s_width => '${rangeWidth $ (p ticker $)}%'
                })
            )
            (dom div { className = 'mt-1 flex justify-between font-mono text-[9px] text-zinc-600' }
                (dom span {} (text $ 'Low'))
                (dom span {} (text $ [rangeText $ (p ticker $)]))
                (dom span {} (text $ 'High'))
            )
        )
        (StatRow $ 'Open' [priceOf $ (p ticker $) 'open'] 'text-zinc-300')
        (StatRow $ 'High' [priceOf $ (p ticker $) 'high'] 'text-emerald-400')
        (StatRow $ 'Low' [priceOf $ (p ticker $) 'low'] 'text-rose-400')
        (StatRow $ 'Bid' [priceOf $ (p ticker $) 'bid'] 'text-emerald-400')
        (StatRow $ 'Ask' [priceOf $ (p ticker $) 'ask'] 'text-rose-400')
        (StatRow $ 'Volume' [compactOf $ (p ticker $) 'volume'] 'text-zinc-300')
        (StatRow $ 'Quote Vol' [compactOf $ (p ticker $) 'quoteVolume'] 'text-zinc-300')
    ) $ ctx
];

Stats
