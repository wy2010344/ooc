// context-menu.ooc —— 复刻 shadcn/ui ContextMenu 家族（new-york-v4，简化版）。
// 无 Radix：ContextMenu 是「函数」不是组件——像 Dialog 那样在事件里调用（createPop 到 portal），
// floating 以光标坐标为参照定位；items 经 CtxMenuCtx 拿到 close。
//   onContextMenu(e){ e preventDefault; ContextMenu $ { x = (e clientX), y = (e clientY) }
//       (ContextMenuItem $ {} '复制') … }
#import { dom, fc, createContext, createPop, floating, storage, iconCheck } '../bridge.ts';
#import { merge, noop, when } './utils.ooc';

// 菜单上下文：items 通过它拿关闭函数（pop 会断开 holder 链，故显式携带）。
CtxMenuCtx = createContext $ nil;

ctxMenuContentBase = 'z-50 min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md';
ctxMenuItemBase = 'relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none';
ctxMenuCheckboxItemBase = 'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none';

// 模版洞内不能含单引号，故比较字面量与类名先提成常量
destructiveVariant = 'destructive';
ctxMenuItemOn = 'text-destructive hover:bg-destructive/10';
ctxMenuItemOff = 'hover:bg-accent hover:text-accent-foreground';

// 记录当前打开的菜单：再次右键时先关掉上一个，避免叠层
lastClose = storage ref noop;

// 在事件里调用：按光标坐标新建一个弹层，返回 close（调用方可忽略；items 经上下文自关）。
ContextMenu = [props, ...children =>
    p = merge $ props { x = 0, y = 0, className = nil };
    px = (p x);
    py = (p y);
    cls = '${ctxMenuContentBase} ${p className}';
    lastClose get $;
    c = createPop $ [ctx, close =>
        ctx provide CtxMenuCtx { close { close $ } };
        (floating $ {
                point = [{ x = px, y = py }],
                className = cls
            } ...children) $ ctx
    ];
    lastClose set c;
    c
];

ContextMenuGroup = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { role = 'group', className => p className } ...children) $ ctx
];

ContextMenuItem = fc $ [ctx, props, ...children =>
    m = ctx consume CtxMenuCtx;
    p = merge $ props { onPress(e) { nil }, variant = 'default', className = nil };
    (dom button {
        type = 'button',
        className => '${ctxMenuItemBase} ${when $ ((p variant) == destructiveVariant) ctxMenuItemOn ctxMenuItemOff} ${p className}',
        onClick(e){ p onPress e; m close }
    } ...children) $ ctx
];

ContextMenuCheckboxItem = fc $ [ctx, props, ...children =>
    p = merge $ props { getValue = noop, setValue = noop, className = nil };
    m = ctx consume CtxMenuCtx;
    (dom button {
        type = 'button',
        className => '${ctxMenuCheckboxItemBase} hover:bg-accent hover:text-accent-foreground ${p className}',
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

ContextMenuLabel = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'px-2 py-1.5 text-sm font-medium ${p className}' } ...children) $ ctx
];

ContextMenuSeparator = fc $ [ctx, props =>
    p = merge $ props { className = nil };
    (dom div { className => '-mx-1 my-1 h-px bg-border ${p className}' }) $ ctx
];

ContextMenuShortcut = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom span { className => 'ml-auto text-xs tracking-widest text-muted-foreground ${p className}' } ...children) $ ctx
];

{
    ContextMenu = ContextMenu,
    ContextMenuGroup = ContextMenuGroup,
    ContextMenuItem = ContextMenuItem,
    ContextMenuCheckboxItem = ContextMenuCheckboxItem,
    ContextMenuLabel = ContextMenuLabel,
    ContextMenuSeparator = ContextMenuSeparator,
    ContextMenuShortcut = ContextMenuShortcut
}
