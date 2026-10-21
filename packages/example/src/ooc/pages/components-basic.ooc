// components-basic.ooc —— 基础组件：Button / Badge 的 variant、size 与动态切换。
#import { fc } '../bridge.ts';
#import { ComponentPage } './component-page.ooc';
#import { Showcase } './showcase.ooc';
#import { VariantDemo } './variant-demo.ooc';

BasicPage = fc $ [ctx =>
    (ComponentPage $ {
        title = '基础组件',
        description = 'Button / Badge 的 variant、size，以及信号驱动的动态切换。'
    }
        (Showcase $)
        (VariantDemo $)
    ) $ ctx
];

BasicPage
