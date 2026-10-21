// site-nav.ooc —— 全站共享导航：hash 路由链接 + 夜间模式切换。
#import { dom, text, fc, dark, toggleTheme } '../bridge.ts';
#import { when } '../ui/utils.ooc';

navLinkClass = 'rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
themeButtonClass = 'rounded-md border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

SiteNav = fc $ [ctx =>
    (dom header { className = 'sticky top-0 z-40 border-b bg-background/90 backdrop-blur' }
        (dom div { className = 'mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3' }
            (dom a { href = '#/', className = 'text-sm font-semibold tracking-tight' } (text $ 'OOC × shadcn'))
            (dom nav { className = 'flex items-center gap-1' }
                (dom a { href = '#/', className = navLinkClass } (text $ '首页'))
                (dom a { href = '#/components', className = navLinkClass } (text $ '组件'))
                (dom button {
                    className = themeButtonClass,
                    title = '切换主题',
                    onClick(e){ toggleTheme $ }
                }
                    (text $ [when $ (dark $) '日间模式' '夜间模式'])
                )
            )
        )
    ) $ ctx
];

SiteNav
