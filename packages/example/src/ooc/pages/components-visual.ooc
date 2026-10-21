// components-visual.ooc —— 可视化分类：Canvas 绘图与 Three 3D。
#import { fc } '../bridge.ts';
#import { ComponentPage } './component-page.ooc';
#import { CanvasDemo } './canvas-demo.ooc';
#import { ThreeDemo } './three-demo.ooc';

VisualPage = fc $ [ctx =>
    (ComponentPage $ {
        title = 'Canvas / 3D',
        description = 'Canvas 绘图与 Three.js 场景。'
    }
        (CanvasDemo $)
        (ThreeDemo $)
    ) $ ctx
];

VisualPage
