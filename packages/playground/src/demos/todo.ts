import type { DemoEntry } from './types.js'

/** 待办清单演示源码（播种 + 测试共用）：createSignal + forEach + toSpliced 完整示范 */
export const TODO_DEMO = `
// 待办清单：createSignal + toSpliced + forEach 区域组件的响应式示范
// 运行后点输出区的「预览」打开：输入 → 添加；点行切换完成态；点「删除」移除。
// 数组用 JS 生态的 Array（globalThis 全局对象）of 构造；不可变改法 / toSpliced（返回新数组）
list = createSignal apply (Array of
    {id=0 , name = '搭一个 OOC 预览', done = true}
    {id=1 , name = '让列表响应信号', done = false}
);
// 输入框受控：value => 只读 λ 显示；onValueChange(v) => ... 是带参方法，宿主把输入新值传进参数 v。
inputText = createSignal apply '';
add = [v => list get / toSpliced 0 0 {id=Date now,name = v, done = false} | list set];
toggle = [i => item = list get/ at i; list get / toSpliced i 1 {id=item id,name = item name, done = item done/ not} | list set];
remove = [i => list get / toSpliced i 1 | list set];
statusOf = [d => d && '[x] ' || '[ ] '];
{
    preview(ctx){
        // 关闭预览时执行：可在这里清理资源
        ctx addDestroy [console log '待办预览关闭';];
        dom div {className = 'space-y-3'}
            (text apply '待办清单')
            // 剩余项数：text apply <λ> 的派生文本——读 list get 自动跟随，
            // 无需再包一个 forEach 区域（信号一变就在原地重写这段文本）
            (text apply [m = list get /filter [x => x done /not]/length; '剩余 ' + m + ' 项'])
            // 列表区域：读到的信号一变，mve 按 keyed diff 增删/复用行（diffMove 维护顺序）
            // / 是级联（结果继续发消息）：list get / forEach [...] ⇔ (list get) |> forEach [...]
            // key 用 item 引用：稳定 key 才能复用行、避免下标位移错位
            // forEach 是区域组件：forEach apply { forEach(block){...}, creater(ic, et, key){...} }
            // 内部委托 mve renderForEach，无需自己拿 ctx
            (forEach apply 
                [forEach => list get / forEach [item, idx => forEach apply (item id) item] ]
                [ic,et=>
                  dom div {className = 'flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2 dark:bg-zinc-800'}
                            // onClick 直接写方法调用；单参数可提前做管道：et index|remove apply ⇔ remove apply (et index)
                        (dom button {onClick => et index|toggle apply}
                                // 级联+管道一体：et value/ done|statusOf apply ⇔ statusOf apply ((et value)/ done)
                                // 作为 text apply 实参时必须整段括起来，否则 value 会被空格拆成裸标识符
                                (text apply [et value/ done|statusOf apply])
                                (text apply [et value/ name]))
                        (dom button {onClick => et index|remove apply} (text apply '删除')) / apply ic
                ]
            )
            (dom div {className = 'flex gap-2'}
                (dom input {
                  className = 'w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900',
                  value => inputText get, 
                  onInput(e) => inputText set (e target / value)
                  
                })
                (dom button {
                    className = 'rounded-full bg-emerald-700 px-3 py-1.5 text-sm text-white dark:bg-emerald-600', 
                    onClick(e){
                      inputText get | add apply; 
                      inputText set ''
                    }
                  }
                  (text apply '添加'))
            ) / apply ctx
        
    }
}
`

/** 待办演示条目 */
export const todo: DemoEntry = {
  name: '待办清单.ooc',
  source: TODO_DEMO,
}