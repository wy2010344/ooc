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

export const SIMPLE_DEMO = `
`

/** 预览演示源码（播种 + 测试共用，避免两份漂移） */
export const PREVIEW_DEMO = `// 预览：运行后点输出区的「预览」打开全屏。
// 组件 = fc apply [ctx, 参数 => 用 ctx.addNode 往界面里放节点]
// 响应式状态：createSignal apply 初值 → { get, set }；渲染里读到的信号一变，forEach 区域自动重建。
list = createSignal apply (Array of);
newName = createSignal apply '';
// 受控输入：value => 只读 λ 显示当前值；onValueChange 是"方法"——宿主把输入框新值
// 作为第一个参数传入，成员里直接写 onValueChange(v) => ... 用 v 接住，像 onClick 一样干净。
Card = fc apply [ctx, title, count =>
    (dom div {className => 'rounded-xl bg-emerald-100 p-3 dark:bg-emerald-950/50'}
        (text apply title)
        (dom div {className => 'mt-1 font-mono text-sm text-emerald-800 dark:text-emerald-400'}
            (text apply count)
        )
    ) / apply ctx
];
// 事件绑方法调用：onClick(e){ addItem apply e } / onClick(e){ delFirst apply e }
// 注意先快照 newItem = (newName get) 再清空信号：行对象 {name => newItem} 是渲染时才取值的，
// 若直接 {name => (newName get)}，同批冲刷里会读到已清空的值。
addItem = [e => xs = list get; newItem = (newName get); list set (xs / toSpliced 0 0 {name => newItem, done => false}); newName set ''];
delFirst = [list get / toSpliced 0 1 | list set];

{
    preview(ctx){
        // 关闭预览时执行：可在这里清理资源
        ctx addDestroy [console log '预览关闭：清理执行';];
        (dom div {className => 'space-y-3'}
            (text apply '组件示例')
            (Card apply '标题' 8)
            // 点击改下面「添加/删除」按钮驱动 list 信号 → forEach 区域自动重建。
            // mve 语义：构建期结束后改界面一律走信号，组件函数在构建窗口内同步执行。
            (text apply '点击按钮修改 list 信号，列表区域响应式重建')
            // 响应式列表：list 变化后整个列表区域重建（改数组返回新数组，旧引用不变）
            // 注意：forEach/creater 要用对象方法（MethodAll）而非绑定值——绑定在消息调用时
            // 只返回绑定结果、不收参数，主机 renderForEach 会 call 不到回调。
            // forEach 是区域组件：forEach apply {...} 内部委托 mve renderForEach，无需自取 ctx
            (forEach apply {
                forEach(block) { list get / forEach [item, idx => block apply item item] },
                creater(ic, et, key) {
                    (dom div {className => 'rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100'}
                        (text apply ((et value) name))
                    ) / apply ic
                }
            })
            // onValueChange 回调参数就是输入框新值：onValueChange => [v => newName set v] ⇔ set((newName)值)
            (dom input {id => 'new-item', value => (newName get), onValueChange(v) => newName set v, className => 'w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900'})
            (dom button {
                className => 'rounded-full bg-emerald-700 px-3 py-1.5 text-sm text-white dark:bg-emerald-600',
                onClick(e){ addItem apply e }
            } (text apply '添加一项'))
            (dom button {
                className => 'rounded-full bg-stone-300 px-3 py-1.5 text-sm text-stone-700 dark:bg-zinc-800 dark:text-zinc-200',
                onClick(e){ delFirst apply e }
            } (text apply '删第一项'))
        ) / apply ctx
    }
}
`

/** 首次打开时的演示笔记（播种） */
export const DEMO_NOTES: Array<{ name: string; source: string }> = [
  {
    name: 'hello.ooc',
    source: `// OOC 记事本：像记事一样写代码，点"运行"看结果\n// 注意：// 是注释，不是除法；除法写 12 div 3\n\nmsg = 'hello ooc';\nmsg / toUpperCase\n`,
  },
  {
    name: '算术.ooc',
    source: `// 运算符无优先级，左结合；顶层语句用 ; 分隔\n// / 是级联（结果继续发消息），除法用 div：12 div 3\n1 + 2 * 3;      // (1+2)*3 = 9\n(1 + 2) * 3;    // 9\n12 div 3;       // 4\n7 % 3           // 1\n`,
  },
  {
    name: 'playground.ooc',
    source: `// 借助注入的宿主对象改页面（类似 Smalltalk）\n// ui add '标签' '文本'：body 里追加元素\nui add 'p' '我从 OOC 生成了这段文字'\n\n// db notes：列出所有笔记\nnotes = db notes;\nnotes\n`,
  },
  {
    name: '预览.ooc',
    source: PREVIEW_DEMO,
  },
  {
    name: '待办清单.ooc',
    source: TODO_DEMO,
  },
]
