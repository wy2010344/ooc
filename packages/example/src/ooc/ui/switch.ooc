// switch.ooc —— 复刻 shadcn/ui Switch（new-york-v4）。
// 无 Radix：button[role=switch] + 滑块；受控 getValue/setValue（同 Input）。
//   Switch $ { size: 'sm'|'default', getValue, setValue, className }
// 注意：模版洞内不能出现单引号（整段是单引号 token），故类名/取值先提成常量。
#import { dom, fc } '../bridge.ts';
#import { merge, noop, pick, when } './utils.ooc';

switchTrack = {
    default = 'h-[1.15rem] w-8',
    sm = 'h-3.5 w-6'
};

switchThumb = {
    default = 'size-4',
    sm = 'size-3'
};

switchOn = 'bg-primary';
switchOff = 'bg-input';
thumbOn = 'translate-x-[calc(100%-2px)]';
thumbOff = 'translate-x-0';

switchDefaults = { size = 'default', getValue = noop, setValue = noop, className = nil };

Switch = fc $ [ctx, props =>
    p = merge $ props switchDefaults;
    (dom button {
        type = 'button',
        role = 'switch',
        className => 'peer inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${pick $ switchTrack (p size)} ${when $ ((p getValue) $) switchOn switchOff} ${p className}',
        onClick(e){ (p setValue) $ (((p getValue) $) / not) }
    }
        (dom span {
            className => 'pointer-events-none block rounded-full bg-background ring-0 transition-transform ${pick $ switchThumb (p size)} ${when $ ((p getValue) $) thumbOn thumbOff}'
        })
    ) $ ctx
];

Switch
