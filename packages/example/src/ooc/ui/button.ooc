// button.ooc —— 复刻 shadcn/ui Button（new-york-v4）。
// 原版用 cva(base, {variants:{variant,size}, defaultVariants}) + cn；这里用类名表 + pick 等价实现。
// 与 React 版差异：无 asChild/Slot（OOC 无 Radix Slot）；children 用剩余参数传（无 content 字段）。
// 参数多，故传 props 对象（字段名可见，无需记顺序）；props 可传 {} 表示全用默认：
//   Button $ { variant, size, className, onPress } '文字' [子组件 …]
#import { dom, fc } '../bridge.ts';
#import { pick, merge } './utils.ooc';

// 基础类名（照搬 shadcn；省略仅对图标生效、且含引号的 [&_svg…] 任意变体）
buttonBase = 'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40';

buttonVariants = {
    default = 'bg-primary text-primary-foreground hover:bg-primary/90',
    destructive = 'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
    outline = 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
    secondary = 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    ghost = 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
    link = 'text-primary underline-offset-4 hover:underline'
};

buttonSizes = {
    default = 'h-9 px-4 py-2 has-[>svg]:px-3',
    xs = 'h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5',
    sm = 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
    lg = 'h-10 rounded-md px-6 has-[>svg]:px-4',
    icon = 'size-9'
};

// 缺省 props：onPress 必须是「方法」——merge 链对方法会带实参调用，对 getter 只取值。
buttonDefaults = {
    variant = 'default',
    size = 'default',
    className = nil,
    onPress(e) { nil }
};

// Button(props, ...children)
Button = fc $ [ctx, props, ...children =>
    p = merge $ props buttonDefaults;
    (dom button {
        className => '${buttonBase} ${pick $ buttonVariants (p variant)} ${pick $ buttonSizes (p size)} ${p className}',
        onClick(e){ p onPress e }
    } ...children) $ ctx
];

Button
