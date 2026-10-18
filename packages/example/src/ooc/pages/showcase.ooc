// showcase.ooc —— 组件 Showcase：列出 Button 全部 variant / size 与 Badge variant。
#import { dom, text, fc } '../bridge.ts';
#import { Button } '../ui/button.ooc';
#import { Badge } '../ui/badge.ooc';
#import { Card, CardHeader, CardTitle, CardDescription, CardContent } '../ui/card.ooc';

Showcase = fc $ [ctx =>
    (Card $ {}
        (CardHeader $ {}
            (CardTitle $ {} '组件 Showcase')
            (CardDescription $ {} '复刻 shadcn 的 variant / size 全集。')
        )
        (CardContent $ {}
            (dom div { className = 'space-y-6' }
                (dom div { className = 'space-y-2' }
                    (dom div { className = 'text-sm font-medium' } (text $ 'Button variants'))
                    (dom div { className = 'flex flex-wrap items-center gap-3' }
                        (Button $ { variant = 'default' } 'Default')
                        (Button $ { variant = 'secondary' } 'Secondary')
                        (Button $ { variant = 'destructive' } 'Destructive')
                        (Button $ { variant = 'outline' } 'Outline')
                        (Button $ { variant = 'ghost' } 'Ghost')
                        (Button $ { variant = 'link' } 'Link')
                    )
                )
                (dom div { className = 'space-y-2' }
                    (dom div { className = 'text-sm font-medium' } (text $ 'Button sizes'))
                    (dom div { className = 'flex flex-wrap items-center gap-3' }
                        (Button $ { size = 'sm' } 'Small')
                        (Button $ {} 'Default')
                        (Button $ { size = 'lg' } 'Large')
                    )
                )
                (dom div { className = 'space-y-2' }
                    (dom div { className = 'text-sm font-medium' } (text $ 'Badge variants'))
                    (dom div { className = 'flex flex-wrap items-center gap-2' }
                        (Badge $ {} 'Default')
                        (Badge $ { variant = 'secondary' } 'Secondary')
                        (Badge $ { variant = 'destructive' } 'Destructive')
                        (Badge $ { variant = 'outline' } 'Outline')
                    )
                )
            )
        )
    ) $ ctx
];

Showcase
