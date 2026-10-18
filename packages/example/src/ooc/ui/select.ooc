// select.ooc —— 复刻 shadcn/ui Select（new-york-v4，简化版）。
// 无 Radix：自管 open；内容经 createPop 到弹层列表（portal）+ floating-ui 定位，
// 宽度跟随触发按钮（matchWidth），数据驱动（options 数组）。
//   Select $ { options, getValue, setValue, placeholder, className }
//   options = (Array of { value = 'a', label = '甲' } { value = 'b', label = '乙' })
// 注意：模版洞内不能含单引号，故类名先提成常量。
#import { dom, text, fc, forEach, multiBind, createSignal, storage, createPop, floating, iconChevronDown } '../bridge.ts';
#import { merge, noop, when } './utils.ooc';

selectTriggerBase = 'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';
selectContentBase = 'z-50 max-h-60 overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md';
selectItemBase = 'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none';

placeholderClass = 'text-muted-foreground';
noClass = '';
itemOnClass = 'bg-accent text-accent-foreground';
itemOffClass = 'hover:bg-accent hover:text-accent-foreground';

selectDefaults = { options = (Array of), placeholder = '请选择', getValue = noop, setValue = noop, className = nil };

// 由选项表按 value 找 label，找不到退回原值。
// 用 #guard 而非 when：when 是普通函数，两个分支都会被求值，found 为空时 (found label) 会炸。
selectLabel = {
    $(opts, v) {
        found = opts / find [o => (o value) == v];
        #guard found;
        found label
        #else;
        v
    }
};

Select = fc $ [ctx, props =>
    p = merge $ props selectDefaults;
    open = multiBind $ (createSignal $ false);
    triggerEl = multiBind $ (storage ref nil);
    closeRef = multiBind $ (storage ref nil);

    closeNow = {
        $ {
            #guard (open $);
            open $ false;
            #guard (closeRef $);
            c = (closeRef $);
            c $;
            closeRef $ nil
        }
    };
    content = {
        $(ctx) {
            (floating $ {
                reference = [(triggerEl $)],
                placement = 'bottom-start',
                matchWidth = true,
                className = '${selectContentBase} ${p className}'
            }
                (forEach $ {
                    forEach(block){ (p options) forEach [o, i => block $ (o value) o] },
                    creater(ic, et, key){
                        (dom button {
                            type = 'button',
                            className => '${selectItemBase} ${when $ (((et value) value) == ((p getValue) $)) itemOnClass itemOffClass}',
                            onClick(e){ (p setValue) $ ((et value) value); closeNow $ }
                        }
                            (text $ ((et value) label))
                        ) $ ic
                    }
                })
            ) $ ctx
        }
    };
    toggle = {
        $(e) {
            #guard (open $);
            closeNow $;
            #else;
            triggerEl $ (e currentTarget);
            closeRef $ (createPop $ [ctx, close => content $ ctx]);
            open $ true
        }
    };

    (dom div { className = 'relative w-full' }
        (dom button {
            type = 'button',
            className => '${selectTriggerBase} ${p className}',
            onClick(e){ toggle $ e }
        }
            (dom span {
                className => 'truncate ${when $ ((p getValue) $) noClass placeholderClass}'
            }
                (text $ [selectLabel $ (p options) ((p getValue) $)])
            )
            (dom span { className = 'size-4 opacity-50' } (iconChevronDown $ { className = 'size-4' }))
        )
    ) $ ctx
];

Select
