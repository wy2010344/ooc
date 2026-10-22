// data-display.ooc —— 数据展示演示：Tabs / Table / Avatar / Separator / Skeleton。
#import { dom, text, fc, forEach, bindSignal } '../bridge.ts';
#import { Card, CardHeader, CardTitle, CardDescription, CardContent } '../ui/card.ooc';
#import { Tabs } '../ui/tabs.ooc';
#import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } '../ui/table.ooc';
#import { Avatar, AvatarFallback } '../ui/avatar.ooc';
#import { Separator } '../ui/separator.ooc';
#import { Skeleton } '../ui/skeleton.ooc';

DataDisplay = fc $ [ctx =>
    tab = bindSignal $ 'overview';
    rows = (Array of
        { name = '张晓', email = 'zhang@x.io', role = '管理员' }
        { name = '李四', email = 'li@x.io', role = '成员' }
        { name = '王五', email = 'wang@x.io', role = '访客' });
    tabs = (Array of
        { value = 'overview', label = '概览', content = [c =>
            (dom p { className = 'text-sm text-muted-foreground' } (text $ '概览面板内容。')) $ c] }
        { value = 'members', label = '成员', content = [c =>
            (dom p { className = 'text-sm text-muted-foreground' } (text $ '成员面板内容。')) $ c] }
    );

    (Card $ {}
        (CardHeader $ {}
            (CardTitle $ {} '数据展示')
            (CardDescription $ {} 'Tabs / Table / Avatar / Separator / Skeleton。')
        )
        (CardContent $ {}
            (dom div { className = 'flex flex-col gap-6' }
                (Tabs $ { tabs = tabs, getValue = tab, setValue = [v => tab $ v] })
                (Separator $ {})
                (dom div { className = 'flex items-center gap-3' }
                    (Avatar $ { size = 'lg' } (AvatarFallback $ {} 'OC'))
                    (dom div {}
                        (dom p { className = 'text-sm font-medium' } (text $ 'OOC 用户'))
                        (dom p { className = 'text-xs text-muted-foreground' } (text $ 'user@ooc.dev'))
                    )
                )
                (dom div { className = 'overflow-hidden rounded-lg border' }
                    (Table $ {}
                        (TableHeader $ {}
                            (TableRow $ {}
                                (TableHead $ {} '姓名')
                                (TableHead $ {} '邮箱')
                                (TableHead $ {} '角色')
                            )
                        )
                        (TableBody $ {}
                            (forEach $ {
                                forEach(block){ rows forEach [r, i => block $ (r email) r] },
                                creater(ic, et, key){
                                    (TableRow $ {}
                                        (TableCell $ {} (text $ [((et value) name)]))
                                        (TableCell $ {} (text $ [((et value) email)]))
                                        (TableCell $ {} (text $ [((et value) role)]))
                                    ) $ ic
                                }
                            })
                        )
                    )
                )
                (dom div { className = 'flex flex-col gap-2' }
                    (Skeleton $ { className = 'h-4 w-1/2' })
                    (Skeleton $ { className = 'h-4 w-1/3' })
                )
            )
        )
    ) $ ctx
];

DataDisplay
