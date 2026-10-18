// checkbox.ooc —— 复刻 shadcn/ui Checkbox（new-york-v4）。
// 无 Radix：button[role=checkbox] + 勾选指示；受控 getValue/setValue（同 Input）。
//   Checkbox $ { getValue, setValue, className }
#import { dom, fc, iconCheck } '../bridge.ts';
#import { merge, noop, when } './utils.ooc';

checkboxBase = 'peer size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';
checkboxOn = 'border-primary bg-primary text-primary-foreground';
checkboxOff = 'border-input dark:bg-input/30';

checkboxDefaults = { getValue = noop, setValue = noop, className = nil };

Checkbox = fc $ [ctx, props =>
    p = merge $ props checkboxDefaults;
    (dom button {
        type = 'button',
        role = 'checkbox',
        className => '${checkboxBase} grid place-content-center ${when $ ((p getValue) $) checkboxOn checkboxOff} ${p className}',
        onClick(e){ (p setValue) $ (((p getValue) $) / not) }
    }
        (dom span {
            className => when $ ((p getValue) $) '' 'hidden'
        } (iconCheck $ { className = 'size-3.5' }))
    ) $ ctx
];

Checkbox
