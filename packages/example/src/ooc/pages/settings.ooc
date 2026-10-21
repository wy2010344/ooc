// settings.ooc —— 账户设置：受控输入 + 计数器 + 保存/重置。
// 信号用 bindSignal、storage ref 用 bindRef 包成 lambda：`x $` 读、`x $ v` 写。
#import { dom, text, fc, bindSignal, bindRef } '../bridge.ts';
#import { Button } '../ui/button.ooc';
#import { Badge } '../ui/badge.ooc';
#import { Input } '../ui/input.ooc';
#import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } '../ui/card.ooc';
#import { StatCard } './stat-card.ooc';

SettingsPanel = fc $ [ctx =>
    name = bindSignal $ 'OOC';
    count = bindSignal $ 0;
    saved = bindSignal $ '';
    // storage ref 是普通可变 cell（非响应式）：bindRef 包成同样的读写 lambda。
    saves = bindRef $ 0;

    (dom div { className = 'space-y-6' }
        (dom div { className = 'grid grid-cols-2 gap-4' }
            (StatCard $ '当前昵称' name 'live' 'secondary')
            (StatCard $ '当前计数' count 'demo' 'outline')
        )

        (Card $ {}
            (CardHeader $ {}
                (CardTitle $ {} '账户设置')
                (CardDescription $ {} '修改昵称并实时预览，或用按钮调整计数。')
            )
            (CardContent $ {}
                (dom div { className = 'space-y-4' }
                    (dom div { className = 'space-y-2' }
                        (dom label { className = 'text-sm font-medium' } (text $ '昵称'))
                        (Input $ { placeholder = '请输入昵称', getValue = name, setValue = [v => name $ v] })
                    )
                    (dom div { className = 'flex items-center gap-2' }
                        (Badge $ {} (text $ ['Hello, ${name $}!']))
                    )
                    (dom div { className = 'flex items-center gap-3' }
                        (Button $ { variant = 'outline', onPress(e){ count $ ((count $) - 1) } } '减少')
                        (dom span { className = 'w-10 text-center text-lg font-semibold tabular-nums' }
                            (text $ count)
                        )
                        (Button $ { onPress(e){ count $ ((count $) + 1) } } '增加')
                    )
                )
            )
            (CardFooter $ {}
                (dom div { className = 'flex w-full items-center justify-between' }
                    (dom span { className = 'text-xs text-muted-foreground' }
                        (text $ ['昵称：${name $}'])
                    )
                    (dom div { className = 'flex gap-2' }
                        (Button $ { variant = 'ghost', onPress(e){ name $ 'OOC' } } '重置')
                        (Button $ { onPress(e){ saves $ ((saves $) + 1); saved $ ('已保存：${name $}（第 ${saves $} 次）') } } '保存')
                    )
                )
            )
        )

        (dom p { className = 'text-xs text-muted-foreground' } (text $ saved))
    ) $ ctx
];

{ SettingsPanel = SettingsPanel }
