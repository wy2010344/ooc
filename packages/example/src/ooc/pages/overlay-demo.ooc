// overlay-demo.ooc —— 浮层演示：Dialog / Sheet（调用方条件创建，内部 portal 到专用容器）。
#import { dom, text, fc, storage } '../bridge.ts';
#import { Card, CardHeader, CardTitle, CardDescription, CardContent } '../ui/card.ooc';
#import { Button } '../ui/button.ooc';
#import { Dialog, DialogHeader, DialogFooter, DialogTitle, DialogDescription } '../ui/dialog.ooc';
#import { Sheet, SheetHeader, SheetFooter, SheetTitle, SheetDescription } '../ui/sheet.ooc';
#import { noop } '../ui/utils.ooc';
OverlayDemo = fc $ [ctx =>
    (Card $ {}
        (CardHeader $ {}
            (CardTitle $ {} '浮层')
            (CardDescription $ {} 'Dialog / Sheet（调用方条件创建，close 存起来关闭）。')
        )
        (CardContent $ {}
            (dom div { className = 'flex gap-3' }
                (Button $ { variant = 'outline', onPress(e){
                    close = storage ref noop;
                    Dialog $ {
                            onClose{
                                close get $
                            }
                        } 
                        (DialogHeader $ {}
                            (DialogTitle $ {} '确认操作')
                            (DialogDescription $ {} '此操作不可撤销，请确认。')
                        )
                        (DialogFooter $ {}
                            (Button $ { variant = 'outline',
                                onPress(e){                                 
                                    close get $ false
                                }
                            } '取消')
                            (Button $ { onPress(e){                           
                                    close get $ true
                            } } '确认')
                        ) | close set
                }} '打开对话框')
                (Button $ { variant = 'outline', onPress(e){
                    close = storage ref noop;
                    Sheet $ { side = 'right', onClose(e){ close get $ } }
                        (SheetHeader $ {}
                            (SheetTitle $ {} '侧边抽屉')
                            (SheetDescription $ {} '从右侧滑出。')
                        )
                        (dom p { className = 'px-4 text-sm' } (text $ '抽屉内容区域。'))
                        (SheetFooter $ {}
                            (Button $ { variant = 'outline', onPress(e){ close get $ } } '关闭')
                        ) | close set
                }} '打开抽屉')
            )
        )
    ) $ ctx
];

OverlayDemo
