// legal.ooc —— 演示环境的免责声明弹层（首次进入自动弹一次，标题栏 DEMO 可再次打开）。
// 目的：这个页面长得像实盘终端、又用了 Binance 公开行情，必须明确「非交易所 / 不会下单 /
// 不构成投资建议 / 与币安无关联」，否则容易被当成官方产品或投顾服务。
//
// 实现要点：
// 1. 不复用 ui/dialog（吃的是 shadcn 浅色令牌，与本页固定深色皮肤不搭），也不走 createPop：
//    弹层挂在全站 portal 上，不随页面卸载；在 addDestroy 里同步 close 会撞信号库的
//    「计算期间不允许修改值」保护。这里就当成页面内的普通节点，靠 fixed 定位盖住全屏，
//    随页面一起卸载，最省事也最安全。
// 2. 显隐由父级传入的 visible 信号驱动，整块始终在树上，只切换 className。
#import { dom, text, fc } '../bridge.ts';
#import { when } '../ui/utils.ooc';

noticeTitleClass = 'font-mono text-[11px] font-semibold tracking-[0.14em] text-amber-300';
noticeBodyClass = 'text-[12px] leading-[1.75] text-zinc-400';
noticeSubClass = 'font-mono text-[10px] tracking-[0.12em] text-zinc-500';
noticeBtnClass = 'rounded-sm border border-white/10 px-2.5 py-1 font-mono text-[10px] text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-100';
noticePrimaryClass = 'rounded-sm border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 font-mono text-[10px] text-amber-200 transition-colors hover:bg-amber-400/20';
noticeOverlayClass = 'fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm';

// 显隐只切 className：洞内可以直接写单引号（词法按 ${} 深度收尾，不会被 '' 截断）。
noticeOverlayClassOf = [visible =>
    '${noticeOverlayClass} ${visible if '' 'hidden'}'
];

// 每条：编号 + 小标题 + 正文。编号只为排版，不用列表语义（这里不是文档正文）。
NoticeLine = fc $ [ctx, index, title, body =>
    (dom div { className = 'flex gap-3' }
        (dom span { className = 'mt-[3px] shrink-0 font-mono text-[10px] text-zinc-600' } index)
        (dom div { className = 'min-w-0 space-y-1' }
            (dom div { className = 'text-[12px] font-medium text-zinc-200' } title)
            (dom p { className = noticeBodyClass } body)
        )
    ) $ ctx
];

// props: visible（信号）、firstTime（首次自动弹出，按钮文案不同）、onDismiss / onAccept。
LegalNotice = fc $ [ctx, props =>
    closeOverlay = [e => (props onDismiss) $];
    (dom div {
            className => noticeOverlayClassOf $ ((props visible) $),
            onClick(e){ closeOverlay $ e }
        }
        (dom div {
                className = 'flex max-h-[86vh] w-full max-w-[520px] flex-col overflow-hidden rounded-md border border-white/10 bg-[#0b0f14] shadow-2xl',
                onClick(e){ e stopPropagation }
            }
            (dom div { className = 'flex items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-400/10 px-5 py-3' }
                (dom span { className = noticeTitleClass } 'DEMO · 非交易所')
                (dom span { className = 'font-mono text-[9px] tracking-[0.16em] text-amber-300/60' } 'NOT AFFILIATED')
            )

            (dom div { className = 'min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4' }
                (dom p { className = 'text-[12px] leading-[1.75] text-zinc-300' }
                    '这是一个行情界面的技术演示：界面、盘口、深度图与「模拟下单」都用于展示 OOC 语言与 mve 渲染引擎的写法，不承担任何真实业务。'
                )
                (NoticeLine $ '01' '与交易所无关'
                    '本页不是交易所，不提供交易、撮合、托管、资管或投资顾问服务。与 Binance（币安）及其关联公司无隶属、合作或背书关系；相关名称与商标归其权利人所有，此处仅用于说明公开行情数据的来源。'
                )
                (NoticeLine $ '02' '不会产生任何委托'
                    '页面没有账户体系、没有 API Key、没有下单通道。右下方 Paper order 只在前端做本地计算，点击后不会向任何服务器发出订单。'
                )
                (NoticeLine $ '03' '行情仅供参考'
                    '数据取自 Binance 公开 REST / WebSocket 接口，由浏览器直连，可能出现延迟、丢帧或断线；所有价格、深度、成交与图表仅用于演示，不构成投资建议，据此决策风险自负。'
                )
                (NoticeLine $ '04' '合规与再分发'
                    '使用或再发布前，请自行确认符合数据提供方的 API 使用条款与所在地法律法规；商用场景需另行取得授权。'
                )
                (NoticeLine $ '05' '无担保'
                    '示例代码按「现状」提供，不对可用性、准确性与特定用途适用性作任何明示或默示担保。'
                )
            )

            (dom div { className = 'flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3' }
                (dom span { className = noticeSubClass } '本提示仅存于本机')
                (dom div { className = 'flex shrink-0 items-center gap-2' }
                    (dom button {
                        type = 'button',
                        className = noticeBtnClass,
                        onClick(e){ (props onDismiss) $ }
                    } (text $ [when $ ((props firstTime) $) '仅本次' '关闭']))
                    (dom button {
                        type = 'button',
                        className = noticePrimaryClass,
                        onClick(e){ (props onAccept) $ }
                    } (text $ [when $ ((props firstTime) $) '我已了解，不再提示' '我已了解']))
                )
            )
        )
    ) $ ctx
];

{ LegalNotice = LegalNotice }
