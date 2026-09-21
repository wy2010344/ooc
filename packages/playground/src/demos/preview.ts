import type { DemoEntry } from './types.js'

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
            // onValueChange 回调接收事件对象，取 e target / value 得输入框新值
            (dom input {id => 'new-item', value => (newName get), onValueChange(e) => newName set (e target / value), className => 'w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900'})
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

/** 预览演示条目 */
export const preview: DemoEntry = {
  name: '预览.ooc',
  source: PREVIEW_DEMO,
}