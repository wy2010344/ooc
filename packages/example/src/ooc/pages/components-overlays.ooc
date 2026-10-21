// components-overlays.ooc —— 浮层分类：DropdownMenu / ContextMenu / Dialog / Sheet。
#import { fc } '../bridge.ts';
#import { ComponentPage } './component-page.ooc';
#import { MenuDemo } './menu-demo.ooc';
#import { OverlayDemo } './overlay-demo.ooc';

OverlaysPage = fc $ [ctx =>
    (ComponentPage $ {
        title = '浮层',
        description = 'DropdownMenu / ContextMenu / Dialog / Sheet（Portal + floating-ui）。'
    }
        (MenuDemo $)
        (OverlayDemo $)
    ) $ ctx
];

OverlaysPage
