// category-nav.ooc —— 组件分类切换：概览 / 基础 / 表单 / 数据 / 浮层 / Canvas & 3D。
#import { dom, text, fc } '../bridge.ts';

categoryNavItemClass = 'rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

CategoryNav = fc $ [ctx =>
    (dom nav { className = 'flex flex-wrap gap-1 rounded-lg border bg-card p-1' }
        (dom a { href = '#/components', className = categoryNavItemClass } (text $ '概览'))
        (dom a { href = '#/components/basic', className = categoryNavItemClass } (text $ '基础'))
        (dom a { href = '#/components/forms', className = categoryNavItemClass } (text $ '表单'))
        (dom a { href = '#/components/data', className = categoryNavItemClass } (text $ '数据'))
        (dom a { href = '#/components/overlays', className = categoryNavItemClass } (text $ '浮层'))
        (dom a { href = '#/components/visual', className = categoryNavItemClass } (text $ 'Canvas / 3D'))
    ) $ ctx
];

CategoryNav
