// dropdown-menu.ooc —— 复刻 shadcn/ui DropdownMenu 家族（new-york-v4，简化版）。
// 无 Radix：DropdownMenu 是「函数」不是组件——像 Dialog 那样在触发元素的事件里调用
// （createPop 到 portal），以触发元素为参照用 floating-ui 定位；items 经 MenuCtx 拿到 close。
//   onPress(e){ DropdownMenu $ { reference = (e currentTarget) } (DropdownMenuItem $ {} '设置') … }
#import { dom, fc, createContext, createPop, floating, storage, iconCheck } '../bridge.ts';
#import { merge, noop, when } './utils.ooc';

// 菜单上下文：items 通过它拿关闭函数（pop 会断开 holder 链，故显式携带）。
MenuCtx = createContext $ nil;

dropdownContentBase = 'z-50 min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md';
dropdownItemBase = 'relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none';
dropdownCheckboxItemBase = 'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none';

// 模版洞内不能含单引号，故比较字面量与类名先提成常量
destructiveVariant = 'destructive';
dropdownItemOn = 'text-destructive hover:bg-destructive/10';
dropdownItemOff = 'hover:bg-accent hover:text-accent-foreground';

// 记录当前打开的菜单：再次点击时先关掉上一个，避免叠层
lastClose = storage ref noop;

// 在事件里调用：以触发元素为参照新建一个弹层，返回 close（调用方可忽略；items 经上下文自关）。
// 注意：reference 必须「事件期同步」取出（currentTarget 出事件后即失效），故先落到局部再延迟用。
DropdownMenu = [props, ...children =>
    p = merge $ props { reference = nil, placement = 'bottom-start', className = nil };
    ref = (p reference);
    place = (p placement);
    cls = '${dropdownContentBase} ${p className}';
    lastClose get $;
    c = createPop $ [ctx, close =>
        ctx provide MenuCtx { close { close $ } };
        (floating $ {
                reference = [ref],
                placement = place,
                className = cls,
                onDismiss = [close $],
                dismissIgnore = [ref]
            } ...children) $ ctx
    ];
    lastClose set c;
    c
];

DropdownMenuGroup = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { role = 'group', className => p className } ...children) $ ctx
];

DropdownMenuItem = fc $ [ctx, props, ...children =>
    m = ctx consume MenuCtx;
    p = merge $ props { onPress(e) { nil }, variant = 'default', className = nil };
    (dom button {
        type = 'button',
        className => '${dropdownItemBase} ${when $ ((p variant) == destructiveVariant) dropdownItemOn dropdownItemOff} ${p className}',
        onClick(e){ p onPress e; m close }
    } ...children) $ ctx
];

DropdownMenuCheckboxItem = fc $ [ctx, props, ...children =>
    p = merge $ props { getValue = noop, setValue = noop, className = nil };
    m = ctx consume MenuCtx;
    (dom button {
        type = 'button',
        className => '${dropdownCheckboxItemBase} hover:bg-accent hover:text-accent-foreground ${p className}',
        onClick(e){ (p setValue) $ (((p getValue) $) / not); m close }
    }
        (dom span { className = 'absolute left-2 flex size-3.5 items-center justify-center' }
            (dom span { className => when $ ((p getValue) $) '' 'hidden' }
                (iconCheck $ { className = 'size-3.5' })
            )
        )
        ...children
    ) $ ctx
];

DropdownMenuLabel = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'px-2 py-1.5 text-sm font-medium ${p className}' } ...children) $ ctx
];

DropdownMenuSeparator = fc $ [ctx, props =>
    p = merge $ props { className = nil };
    (dom div { className => '-mx-1 my-1 h-px bg-border ${p className}' }) $ ctx
];

DropdownMenuShortcut = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom span { className => 'ml-auto text-xs tracking-widest text-muted-foreground ${p className}' } ...children) $ ctx
];

{
    DropdownMenu = DropdownMenu,
    DropdownMenuGroup = DropdownMenuGroup,
    DropdownMenuItem = DropdownMenuItem,
    DropdownMenuCheckboxItem = DropdownMenuCheckboxItem,
    DropdownMenuLabel = DropdownMenuLabel,
    DropdownMenuSeparator = DropdownMenuSeparator,
    DropdownMenuShortcut = DropdownMenuShortcut
}
