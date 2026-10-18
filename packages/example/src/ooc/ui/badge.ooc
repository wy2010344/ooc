// badge.ooc —— 复刻 shadcn/ui Badge（new-york-v4）。
// 原版 cva(base, {variant})；这里类名表 + pick。无 asChild/Slot。
// 与 Button 对齐：props 对象（可 {} 全默认）+ children 剩余参数 + className 模板。
//   Badge $ { variant, className } '文字' [子组件 …]
#import { dom, fc } '../bridge.ts';
#import { pick, merge } './utils.ooc';

badgeBase = 'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40';

badgeVariants = {
    default = 'bg-primary text-primary-foreground',
    secondary = 'bg-secondary text-secondary-foreground',
    destructive = 'bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
    outline = 'border-border text-foreground',
    ghost = 'hover:bg-accent hover:text-accent-foreground',
    link = 'text-primary underline-offset-4 hover:underline'
};

badgeDefaults = {
    variant = 'default',
    className = nil
};

// Badge(props, ...children)
Badge = fc $ [ctx, props, ...children =>
    p = merge $ props badgeDefaults;
    (dom span {
        className => '${badgeBase} ${pick $ badgeVariants (p variant)} ${p className}'
    } ...children) $ ctx
];

Badge
