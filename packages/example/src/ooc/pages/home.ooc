// home.ooc — 首页：项目介绍 + OOC 语言特性演示
#import { dom, text, fc } '../bridge.ts';
#import { Card, CardHeader, CardTitle } '../ui/card.ooc';
#import { SiteNav } './site-nav.ooc';

math = #import '../math';

// 可区分联合 + guard 分支
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

// 对象方法
hello = { greet(name) { 'Hello, ${name}!' } };

// 顶层先求值，避免模板字符串洞在 fc 局部作用域里的 TDZ 误报
circleArea = (area calc { kind = 'circle', radius = 5 });
squareArea = (area calc { kind = 'square', side = 4 });
mathResult = (math add 2 3);
greeting = (hello greet 'World');

// 语言特性小卡：标题 + 等宽值
FeatureCard = fc $ [ctx, title, value =>
    (Card $ {}
        (CardHeader $ {}
            (CardTitle $ {} title)
            (dom div { className = 'mt-2 font-mono text-sm text-primary' } (text $ value))
        )
    ) $ ctx
];

Home = fc $ [ctx =>
    (dom div { className = 'min-h-screen bg-muted/40 pb-12' }
        (SiteNav $)

        (dom main { className = 'mx-auto max-w-3xl space-y-8 px-6 py-10' }
            (dom section { className = 'space-y-4' }
                (dom h1 { className = 'text-3xl font-bold tracking-tight' } (text $ 'OOC × shadcn'))
                (dom p { className = 'max-w-2xl text-muted-foreground' }
                    (text $ '用 OOC 语言写组件、Tailwind v4 做主题令牌，复刻 shadcn 风格 UI。')
                )
                (dom a {
                    href = '#/components',
                    className = 'inline-flex h-9 w-fit items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
                } (text $ '查看组件库'))
            )

            (dom section { className = 'space-y-4' }
                (dom h2 { className = 'text-lg font-semibold tracking-tight' } (text $ '语言特性'))
                (dom div { className = 'grid grid-cols-1 gap-4 sm:grid-cols-2' }
                    (FeatureCard $ '联合类型 + guard' '${circleArea} / ${squareArea}')
                    (FeatureCard $ '模块导入 (math)' '${mathResult}')
                    (FeatureCard $ '对象方法' greeting)
                    (FeatureCard $ '表达式求值' (math double 21))
                )
            )
        )
    ) $ ctx
];

Home
