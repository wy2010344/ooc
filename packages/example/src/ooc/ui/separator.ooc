// separator.ooc —— 复刻 shadcn/ui Separator（new-york-v4）。
// 无 Radix：纯 div，按 orientation 切类名。
//   Separator $ { orientation: 'horizontal'|'vertical', className }
#import { dom, fc } '../bridge.ts';
#import { merge, pick } './utils.ooc';

separatorOrient = {
    horizontal = 'h-px w-full',
    vertical = 'h-full w-px'
};

separatorDefaults = { orientation = 'horizontal', className = nil };

Separator = fc $ [ctx, props =>
    p = merge $ props separatorDefaults;
    (dom div {
        className => 'shrink-0 bg-border ${pick $ separatorOrient (p orientation)} ${p className}'
    }) $ ctx
];

Separator
