// tabs.ooc —— 复刻 shadcn/ui Tabs 家族（new-york-v4，简化版）。
// 无 Radix：数据驱动（tabs 数组），受控 getValue/setValue；面板常驻、按激活态切显隐。
//   Tabs $ { tabs, getValue, setValue, className }
//   tabs = (Array of { value = 'a', label = '甲', content = [ctx => …] })
#import { dom, text, fc, forEach } '../bridge.ts';
#import { merge, noop, when } './utils.ooc';

tabsRootBase = 'flex flex-col gap-2';
tabsListBase = 'inline-flex h-9 w-fit items-center justify-center gap-1 rounded-lg bg-muted p-[3px] text-muted-foreground';
tabsTriggerBase = 'relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-all';
tabsTriggerOn = 'bg-background text-foreground shadow-sm';
tabsTriggerOff = 'text-foreground/60 hover:text-foreground';
tabsShown = 'block';
tabsHidden = 'hidden';

tabsDefaults = { tabs = (Array of), getValue = noop, setValue = noop, className = nil };

Tabs = fc $ [ctx, props =>
    p = merge $ props tabsDefaults;
    (dom div { className => '${tabsRootBase} ${p className}' }
        (dom div { className = tabsListBase }
            (forEach $ {
                forEach(block){ (p tabs) forEach [t, i => block $ (t value) t] },
                creater(ic, et, key){
                    (dom button {
                        type = 'button',
                        className => '${tabsTriggerBase} ${when $ (((et value) value) == ((p getValue) $)) tabsTriggerOn tabsTriggerOff}',
                        onClick(e){ (p setValue) $ ((et value) value) }
                    }
                        (text $ [((et value) label)])
                    ) $ ic
                }
            })
        )
        (forEach $ {
            forEach(block){ (p tabs) forEach [t, i => block $ (t value) t] },
            creater(ic, et, key){
                (dom div {
                    className => '${when $ (((et value) value) == ((p getValue) $)) tabsShown tabsHidden}'
                }
                    ((et value) content)
                ) $ ic
            }
        })
    ) $ ctx
];

Tabs
