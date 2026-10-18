// kit.ooc —— 组件库扩展展示：表单控件 / 下拉菜单 / 数据展示 / 浮层。
#import { dom, fc } '../bridge.ts';
#import { FormControls } './form-controls.ooc';
#import { MenuDemo } './menu-demo.ooc';
#import { DataDisplay } './data-display.ooc';
#import { OverlayDemo } './overlay-demo.ooc';

Kit = fc $ [ctx =>
    (dom div { className = 'space-y-6' }
        (FormControls $)
        (MenuDemo $)
        (DataDisplay $)
        (OverlayDemo $)
    ) $ ctx
];

Kit
