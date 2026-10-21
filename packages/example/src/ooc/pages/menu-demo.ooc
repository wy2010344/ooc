// menu-demo.ooc —— 菜单演示：DropdownMenu（下拉菜单）+ ContextMenu（右键菜单）。
// 两者都是「函数」：在触发元素的事件里调用（像 Dialog），内部 portal 到 body、floating 定位。
#import { dom, text, fc, bindSignal } '../bridge.ts';
#import { Card, CardHeader, CardTitle, CardDescription, CardContent } '../ui/card.ooc';
#import { Button } '../ui/button.ooc';
#import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuCheckboxItem } '../ui/dropdown-menu.ooc';
#import { ContextMenu, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuCheckboxItem } '../ui/context-menu.ooc';

MenuDemo = fc $ [ctx =>
    checked = bindSignal $ true;
    last = bindSignal $ '（未选择）';

    (dom div { className = 'space-y-6' }
        (Card $ {}
            (CardHeader $ {}
                (CardTitle $ {} '下拉菜单')
                (CardDescription $ {} 'DropdownMenu：标签 / 分隔 / 项 / 复选 / 快捷键。')
            )
            (CardContent $ {}
                (Button $ { variant = 'outline', onPress(e){
                    DropdownMenu $ { reference = (e currentTarget) }
                        (DropdownMenuLabel $ {} '我的账户')
                        (DropdownMenuSeparator $ {})
                        (DropdownMenuItem $ { onPress(e){ last $ '个人资料' } }
                            '个人资料'
                            (DropdownMenuShortcut $ {} '⇧⌘P')
                        )
                        (DropdownMenuItem $ { onPress(e){ last $ '设置' } }
                            '设置'
                            (DropdownMenuShortcut $ {} '⌘S')
                        )
                        (DropdownMenuSeparator $ {})
                        (DropdownMenuCheckboxItem $ { getValue = checked, setValue = [v => checked $ v] }
                            '显示状态栏'
                        )
                        (DropdownMenuSeparator $ {})
                        (DropdownMenuItem $ { variant = 'destructive', onPress(e){ last $ '退出' } }
                            '退出登录'
                        )
                }} '打开菜单')
                (dom p { className = 'mt-3 text-sm text-muted-foreground' }
                    (text $ ['最近操作：' + (last $)])
                )
            )
        )

        (Card $ {}
            (CardHeader $ {}
                (CardTitle $ {} '右键菜单')
                (CardDescription $ {} 'ContextMenu：在触发区右键，菜单出现在光标处。')
            )
            (CardContent $ {}
                (dom div {
                    className = 'flex h-32 w-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground',
                    onContextMenu(e){
                        e preventDefault;
                        ContextMenu $ { x = (e clientX), y = (e clientY) }
                            (ContextMenuLabel $ {} '操作')
                            (ContextMenuSeparator $ {})
                            (ContextMenuItem $ { onPress(e){ last $ '复制' } }
                                '复制'
                                (ContextMenuShortcut $ {} '⌘C')
                            )
                            (ContextMenuItem $ { onPress(e){ last $ '粘贴' } }
                                '粘贴'
                                (ContextMenuShortcut $ {} '⌘V')
                            )
                            (ContextMenuSeparator $ {})
                            (ContextMenuCheckboxItem $ { getValue = checked, setValue = [v => checked $ v] }
                                '显示状态栏'
                            )
                            (ContextMenuSeparator $ {})
                            (ContextMenuItem $ { variant = 'destructive', onPress(e){ last $ '删除' } }
                                '删除'
                            )
                    }
                } '在此区域右键')
            )
        )
    ) $ ctx
];

MenuDemo
