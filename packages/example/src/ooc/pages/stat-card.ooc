// stat-card.ooc —— 统计小卡：说明文字 + 大数字（可响应式）+ 徽标。
// value 传 lambda / 桥接信号即可响应式（text 把函数当 GetValue 反复读）。
#import { dom, text, fc } '../bridge.ts';
#import { Badge } '../ui/badge.ooc';
#import { Card, CardHeader, CardDescription } '../ui/card.ooc';

StatCard = fc $ [ctx, label, value, badge, variant =>
    (Card $ {}
        (CardHeader $ {}
            (CardDescription $ {} label)
            (dom div { className = 'mt-1 flex items-center gap-2' }
                (dom span { className = 'text-2xl font-bold tracking-tight' } (text $ value))
                (Badge $ { variant = variant } badge)
            )
        )
    ) $ ctx
];

StatCard
