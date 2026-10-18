// variant-demo.ooc —— 动态切换：multiBind 信号作 lambda（无参读、单参写）。
// props 用 `=>` 方法读信号（每次读重算），Button 的 className 随之更新。
#import { dom, text, fc, multiBind, createSignal } '../bridge.ts';
#import { Button } '../ui/button.ooc';
#import { Card, CardHeader, CardTitle, CardDescription, CardContent } '../ui/card.ooc';

VariantDemo = fc $ [ctx =>
    variant = multiBind $ (createSignal $ 'default');
    size = multiBind $ (createSignal $ 'default');

    (Card $ {}
        (CardHeader $ {}
            (CardTitle $ {} '动态切换 variant / size')
            (CardDescription $ {} '信号作 lambda：variant $ 读、variant $ x 写。')
        )
        (CardContent $ {}
            (dom div { className = 'space-y-6' }
                // 预览：label 与样式都随信号实时变化
                (dom div { className = 'flex items-center justify-center rounded-lg border border-dashed p-8' }
                    (Button $ { variant <= variant, size <= size }
                        (text $ ['${variant $} / ${size $}'])
                    )
                )
                (dom div { className = 'space-y-2' }
                    (dom div { className = 'text-sm font-medium' } (text $ 'variant'))
                    (dom div { className = 'flex flex-wrap gap-2' }
                        (Button $ { variant = 'outline', size = 'sm', onPress(e){ variant $ 'default' } } 'default')
                        (Button $ { variant = 'outline', size = 'sm', onPress(e){ variant $ 'secondary' } } 'secondary')
                        (Button $ { variant = 'outline', size = 'sm', onPress(e){ variant $ 'destructive' } } 'destructive')
                        (Button $ { variant = 'outline', size = 'sm', onPress(e){ variant $ 'outline' } } 'outline')
                        (Button $ { variant = 'outline', size = 'sm', onPress(e){ variant $ 'ghost' } } 'ghost')
                        (Button $ { variant = 'outline', size = 'sm', onPress(e){ variant $ 'link' } } 'link')
                    )
                )
                (dom div { className = 'space-y-2' }
                    (dom div { className = 'text-sm font-medium' } (text $ 'size'))
                    (dom div { className = 'flex flex-wrap gap-2' }
                        (Button $ { variant = 'outline', size = 'sm', onPress(e){ size $ 'sm' } } 'sm')
                        (Button $ { variant = 'outline', size = 'sm', onPress(e){ size $ 'default' } } 'default')
                        (Button $ { variant = 'outline', size = 'sm', onPress(e){ size $ 'lg' } } 'lg')
                    )
                )
            )
        )
    ) $ ctx
];

VariantDemo
