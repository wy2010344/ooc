// card.ooc —— 复刻 shadcn/ui Card 家族（new-york-v4）。
// 与 Button 对齐：props 对象（可 {} 全默认）+ children 剩余参数 + className 模板。
//   Card $ { className } ...children / CardTitle $ { className } '标题' ...
#import { dom, fc } '../bridge.ts';
#import { merge } './utils.ooc';

cardClass = 'flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm';
cardHeaderClass = 'grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6';
cardTitleClass = 'leading-none font-semibold';
cardDescriptionClass = 'text-sm text-muted-foreground';
cardContentClass = 'px-6';
cardFooterClass = 'flex items-center px-6';

cardDefaults = { className = nil };

Card = fc $ [ctx, props, ...children =>
    p = merge $ props cardDefaults;
    (dom div { className => '${cardClass} ${p className}' } ...children) $ ctx
];

CardHeader = fc $ [ctx, props, ...children =>
    p = merge $ props cardDefaults;
    (dom div { className => '${cardHeaderClass} ${p className}'} ...children) $ ctx
];

CardTitle = fc $ [ctx, props, ...children =>
    p = merge $ props cardDefaults;
    (dom div { className => '${cardTitleClass} ${p className}' } ...children) $ ctx
];

CardDescription = fc $ [ctx, props, ...children =>
    p = merge $ props cardDefaults;
    (dom div { className => '${cardDescriptionClass} ${p className}' } ...children) $ ctx
];

CardContent = fc $ [ctx, props, ...children =>
    p = merge $ props cardDefaults;
    (dom div { className => '${cardContentClass} ${p className}' } ...children) $ ctx
];

CardFooter = fc $ [ctx, props, ...children =>
    p = merge $ props cardDefaults;
    (dom div { className => '${cardFooterClass} ${p className}' } ...children) $ ctx
];

{
    Card = Card,
    CardHeader = CardHeader,
    CardTitle = CardTitle,
    CardDescription = CardDescription,
    CardContent = CardContent,
    CardFooter = CardFooter
}
