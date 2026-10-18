// sheet.ooc —— 复刻 shadcn/ui Sheet 家族（new-york-v4，简化版）。
// 无 Radix：由调用方条件创建（`Sheet $ {…} (…) | close set`，createPop 返回的 close 存起来关闭）；
// 用 portal（createPop 到弹层列表）避免组件级 overflow 裁剪；遮罩 + 侧边抽屉，按 side 切类名；
// 遮罩点击只回调 onClose。
//   Sheet $ { onClose, side: 'top'|'right'|'bottom'|'left', className } (SheetHeader $ {} …) …
#import { dom, fc, createPop } '../bridge.ts';
#import { merge, pick } './utils.ooc';

sheetSide = {
    right = 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
    left = 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
    top = 'inset-x-0 top-0 h-auto border-b',
    bottom = 'inset-x-0 bottom-0 h-auto border-t'
};

sheetOverlayBase = 'fixed inset-0 z-50 bg-black/50';
sheetContentBase = 'fixed z-50 flex flex-col gap-4 bg-background shadow-lg';

// onClose 缺省给空方法，避免调用方不传时直接对 nil 发 $。
sheetDefaults = { onClose(e) { nil }, side = 'right', className = nil };

Sheet = [props, ...children =>
    p = merge $ props sheetDefaults;
    createPop $ [ctx, close =>
        // 遮罩与抽屉必须是「兄弟」：抽屉若是遮罩的子节点，点抽屉内容会冒泡到遮罩把抽屉关掉。
        (dom div {}
            (dom div {
                    className = sheetOverlayBase,
                    onClick(e){ p onClose e }
                }
            )
            (dom div { className => '${sheetContentBase} ${pick $ sheetSide (p side)} ${p className}' } ...children)
        ) $ ctx

    ];
];

SheetHeader = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'flex flex-col gap-1.5 p-4 ${p className}' } ...children) $ ctx
];

SheetFooter = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'mt-auto flex flex-col gap-2 p-4 ${p className}' } ...children) $ ctx
];

SheetTitle = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'font-semibold text-foreground ${p className}' } ...children) $ ctx
];

SheetDescription = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'text-sm text-muted-foreground ${p className}' } ...children) $ ctx
];

{
    Sheet = Sheet,
    SheetHeader = SheetHeader,
    SheetFooter = SheetFooter,
    SheetTitle = SheetTitle,
    SheetDescription = SheetDescription
}
