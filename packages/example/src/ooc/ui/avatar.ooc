// avatar.ooc —— 复刻 shadcn/ui Avatar 家族（new-york-v4）。
// 无 Radix：图片加载失败回退交给浏览器，AvatarFallback 始终垫在底层。
//   Avatar $ { size: 'sm'|'default'|'lg', className } ...children
//     AvatarImage $ { src, alt, className }
//     AvatarFallback $ {} 'AB'
#import { dom, fc } '../bridge.ts';
#import { merge, pick } './utils.ooc';

avatarSize = {
    sm = 'size-6',
    default = 'size-8',
    lg = 'size-10'
};

avatarDefaults = { size = 'default', className = nil };

Avatar = fc $ [ctx, props, ...children =>
    p = merge $ props avatarDefaults;
    (dom span {
        className => 'group/avatar relative flex shrink-0 overflow-hidden rounded-full select-none ${pick $ avatarSize (p size)} ${p className}'
    } ...children) $ ctx
];

AvatarImage = fc $ [ctx, props =>
    p = merge $ props { src = '', alt = '', className = nil };
    (dom img {
        src => (p src),
        alt = (p alt),
        className => 'absolute inset-0 aspect-square size-full object-cover ${p className}'
    }) $ ctx
];

AvatarFallback = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom span {
        className => 'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ${p className}'
    } ...children) $ ctx
];

AvatarBadge = fc $ [ctx, props, ...children =>
    p = merge $ props { className = nil };
    (dom span {
        className => 'absolute right-0 bottom-0 z-10 inline-flex size-2.5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none ${p className}'
    } ...children) $ ctx
];

{
    Avatar = Avatar,
    AvatarImage = AvatarImage,
    AvatarFallback = AvatarFallback,
    AvatarBadge = AvatarBadge
}
