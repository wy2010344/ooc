// skeleton.ooc —— 复刻 shadcn/ui Skeleton（new-york-v4）。
// 加载占位：animate-pulse 灰块。
//   Skeleton $ { className }
#import { dom, fc } '../bridge.ts';
#import { merge } './utils.ooc';

skeletonBase = 'animate-pulse rounded-md bg-accent';
skeletonDefaults = { className = nil };

Skeleton = fc $ [ctx, props =>
    p = merge $ props skeletonDefaults;
    (dom div { className => '${skeletonBase} ${p className}' }) $ ctx
];

Skeleton
