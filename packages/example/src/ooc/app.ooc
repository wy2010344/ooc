// app.ooc — 示例应用入口：Tailwind + shadcn 风格组件的组合页。
// 主体是组件库组合页（pages/settings.ooc），下方保留语言特性演示（联合类型/guard、模块导入、对象方法）。
#import { dom, text, fc } './bridge.ts';
#import { Card, CardHeader, CardTitle } './ui/card.ooc';
#import { SettingsPanel } './pages/settings.ooc';

// ===== 语言能力演示 =====
math = #import 'math';

// 可区分联合 + guard 分支链
Circle #type { kind: 'circle', radius: number };
Square #type { kind: 'square', side: number };

area = {
    calc(s: Circle | Square) {
        #guard (s kind) == 'circle';
        (s radius) * (s radius) * 3.14
        #guard (s kind) == 'square';
        (s side) * (s side)
        #else;
        nil
    }
};

x=[a=>
    [b=>
        [c=>
            a+b+c
        ]
    ]
];
console log (x $ 1 $ 2 $ 3);

// 对象方法
hello = { greet(name) { 'Hello, ${name}!' } };

// 语言特性小卡：标题 + 等宽值
FeatureCard = fc $ [ctx, title, value =>
    (Card $ {}
        (CardHeader $ {}
            (CardTitle $ {} title)
            (dom div { className = 'mt-2 font-mono text-sm text-primary' } (text $ value))
        )
    ) $ ctx
];

{
    preview(ctx){
        ctx addDestroy [console log 'app 预览关闭';];

        circleArea = (area calc { kind = 'circle', radius = 5 });
        squareArea = (area calc { kind = 'square', side = 4 });
        mathResult = (math add 2 3);
        greeting = (hello greet 'World');

        (dom div { className = 'min-h-screen bg-muted/40 pb-12' }
            (dom header { className = 'mx-auto max-w-2xl px-6 pt-6' }
                (dom h1 { className = 'text-2xl font-bold tracking-tight' } (text $ 'OOC × shadcn'))
                (dom p { className = 'text-sm text-muted-foreground' }
                    (text $ '用 OOC 语言写组件、Tailwind v4 做主题令牌，复刻 shadcn 风格 UI。'))
            )

            // 组件库组合页（复杂组合示例）
            (SettingsPanel $)

            // 语言特性演示
            (dom section { className = 'mx-auto max-w-2xl space-y-4 px-6' }
                (dom h2 { className = 'text-lg font-semibold tracking-tight' } (text $ '语言特性'))
                (dom div { className = 'grid grid-cols-2 gap-4' }
                    (FeatureCard $ '联合类型 + guard' '${circleArea} / ${squareArea}')
                    (FeatureCard $ '模块导入 (math)' '${mathResult}')
                    (FeatureCard $ '对象方法' greeting)
                    (FeatureCard $ '表达式求值' (math double 21))
                )
            )
        ) $ ctx
    }
}
