// form-controls.ooc —— 表单控件演示：Checkbox / Switch / Select（受控信号）。
// 信号用 bindSignal 包成 lambda：`x $` 读、`x $ v` 写。
#import { dom, text, fc, bindSignal } '../bridge.ts';
#import { Card, CardHeader, CardTitle, CardDescription, CardContent } '../ui/card.ooc';
#import { Checkbox } '../ui/checkbox.ooc';
#import { Switch } '../ui/switch.ooc';
#import { Select } '../ui/select.ooc';
#import { Separator } '../ui/separator.ooc';
#import { when } '../ui/utils.ooc';

FormControls = fc $ [ctx =>
    agree = bindSignal $ true;
    notify = bindSignal $ false;
    plan = bindSignal $ 'free';
    plans = (Array of
        { value = 'free', label = '免费版' }
        { value = 'pro', label = '专业版' }
        { value = 'team', label = '团队版' });
    agreeOn = '已同意';
    agreeOff = '未同意';

    (Card $ {}
        (CardHeader $ {}
            (CardTitle $ {} '表单控件')
            (CardDescription $ {} 'Checkbox / Switch / Select（受控信号）。')
        )
        (CardContent $ {}
            (dom div { className = 'flex flex-col gap-4' }
                (dom div { className = 'flex items-center gap-2' }
                    (Checkbox $ { getValue = agree, setValue = [v => agree $ v] })
                    (dom label { className = 'text-sm' }
                        (text $ ['同意条款（' + (when $ (agree $) agreeOn agreeOff) + '）'])
                    )
                )
                (Separator $ {})
                (dom div { className = 'flex items-center justify-between' }
                    (dom label { className = 'text-sm' } (text $ '接收通知'))
                    (Switch $ { getValue = notify, setValue = [v => notify $ v] })
                )
                (Separator $ {})
                (dom div { className = 'flex flex-col gap-2' }
                    (dom label { className = 'text-sm font-medium' } (text $ '套餐'))
                    (dom div { className = 'w-56' }
                        (Select $ { options = plans, getValue = plan, setValue = [v => plan $ v] })
                    )
                    (dom p { className = 'text-xs text-muted-foreground' }
                        (text $ ['当前套餐值：' + (plan $)])
                    )
                )
            )
        )
    ) $ ctx
];

FormControls
