// component-page.ooc —— 组件分类页统一外壳：站点导航 + 标题 + 分类切换 + 内容。
#import { dom, text, fc } '../bridge.ts';
#import { SiteNav } './site-nav.ooc';
#import { CategoryNav } './category-nav.ooc';

ComponentPage = fc $ [ctx, props, ...children =>
    p = props;
    (dom div { className = 'min-h-screen bg-muted/40 pb-12' }
        (SiteNav $)
        (dom main { className = 'mx-auto max-w-3xl space-y-6 px-6 py-8' }
            (dom header { className = 'space-y-1' }
                (dom h1 { className = 'text-3xl font-bold tracking-tight' } (text $ (p title)))
                (dom p { className = 'text-sm text-muted-foreground' } (text $ (p description)))
            )
            (CategoryNav $)
            ...children
        )
    ) $ ctx
];

ComponentPage
