// dialog.ooc —— 复刻 shadcn/ui Dialog 家族（new-york-v4，简化版）。
// 无 Radix：由调用方条件创建（`Dialog $ {…} (…) | close set`，createPop 返回的 close 存起来关闭）；
// 用 portal（createPop 到弹层列表）避免组件级 overflow 裁剪；遮罩点击只回调 onClose。
//   Dialog $ { onClose, className } (DialogHeader $ {} (DialogTitle $ {} '标题') …) …
#import { dom, fc, createPop } '../bridge.ts';
#import { merge } './utils.ooc';

dialogOverlayBase = 'fixed inset-0 z-50 bg-black/50';
dialogContentBase = 'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg';

// onClose 缺省给空方法，避免调用方不传时直接对 nil 发 $。
dialogDefaults = { onClose(e) { nil }, className = nil };

Dialog = [props, ...children =>
    p = merge $ props dialogDefaults;
    createPop $ [ctx,close =>
        // 遮罩与内容必须是「兄弟」：内容若是遮罩的子节点，点内容会冒泡到遮罩把对话框关掉。
        (dom div {}
            (dom div {
                    className = dialogOverlayBase,
                    onClick(e){ p onClose e }
                }
            )
            (dom div { className => '${dialogContentBase} ${p className}' } ...children)
        ) $ ctx

    ];
];


DialogHeader = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'flex flex-col gap-2 text-center sm:text-left ${p className}' } ...children) $ ctx
];

DialogFooter = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end ${p className}' } ...children) $ ctx
];

DialogTitle = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'text-lg leading-none font-semibold ${p className}' } ...children) $ ctx
];

DialogDescription = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom div { className => 'text-sm text-muted-foreground ${p className}' } ...children) $ ctx
];

{
    Dialog = Dialog,
    DialogHeader = DialogHeader,
    DialogFooter = DialogFooter,
    DialogTitle = DialogTitle,
    DialogDescription = DialogDescription
}
