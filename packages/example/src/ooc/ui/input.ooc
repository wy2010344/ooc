// input.ooc —— 复刻 shadcn/ui Input（new-york-v4）。
// 受控输入：getValue 惰性绑定 value，setValue 收输入事件。
// 与 Button 对齐：props 对象（可 {} 全默认）+ className 模板。
//   Input $ { placeholder, getValue, setValue, className }
#import { dom, fc } '../bridge.ts';
#import { merge, noop } './utils.ooc';

inputBase = 'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40';

inputDefaults = {
    placeholder = '',
    className = nil,
    getValue = noop,
    setValue = noop
};

// Input(props)
Input = fc $ [ctx, props =>
    p = merge $ props inputDefaults;
    (dom input {
        className => '${inputBase} ${p className}',
        placeholder = (p placeholder),
        value => (p getValue) $,
        onInput(e){ (p setValue) $ (e target / value) }
    }) $ ctx
];

Input
