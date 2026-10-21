// components.ooc —— 组件库概览：按分类进入基础 / 表单 / 数据 / 浮层 / Canvas & 3D。
#import { dom, text, fc } '../bridge.ts';
#import { ComponentPage } './component-page.ooc';
#import { StatCard } './stat-card.ooc';

CategoryCard = fc $ [ctx, props =>
    p = props;
    (dom a {
        href = p href,
        className = 'rounded-xl border bg-card p-5 transition-colors hover:border-ring hover:bg-accent/40'
    }
        (dom div { className = 'text-sm font-semibold' } (text $ (p title)))
        (dom p { className = 'mt-1 text-sm text-muted-foreground' } (text $ (p description)))
        (dom span { className = 'mt-4 inline-block text-xs font-medium text-primary' } (text $ '查看'))
    ) $ ctx
];

Components = fc $ [ctx =>
    (ComponentPage $ {
        title = '组件库',
        description = '用 OOC 复刻 shadcn 风格组件，按类别浏览。'
    }
        (dom div { className = 'grid gap-4 sm:grid-cols-2' }
            (CategoryCard $ {
                href = '#/components/basic',
                title = '基础组件',
                description = 'Button / Badge 的 variant、size 与动态切换。'
            })
            (CategoryCard $ {
                href = '#/components/forms',
                title = '表单',
                description = '账户设置、输入框、Checkbox / Switch / Select。'
            })
            (CategoryCard $ {
                href = '#/components/data',
                title = '数据展示',
                description = 'Tabs / Table / Avatar / Separator / Skeleton。'
            })
            (CategoryCard $ {
                href = '#/components/overlays',
                title = '浮层',
                description = 'DropdownMenu / ContextMenu / Dialog / Sheet。'
            })
            (CategoryCard $ {
                href = '#/components/visual',
                title = 'Canvas / 3D',
                description = 'Canvas 绘图与 Three.js 场景。'
            })
        )
        (dom div { className = 'grid grid-cols-2 gap-4' }
            (StatCard $ '组件分类' '5' '分类' 'secondary')
            (StatCard $ '主题模式' '浅色 / 深色' '导航切换' 'outline')
        )
    ) $ ctx
];

Components
