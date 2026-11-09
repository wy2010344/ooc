// 画布舞台（对应 canvasRender2/Renderer.ts 的宿主绑定部分）。
// 只做四件事：建 canvas、同步尺寸、装配根节点与子树、把 DOM 事件翻成指针派发并触发重绘。
// 焦点 / 选区 / IME / 浮层属于后续批次，这里不掺进来。

#import {
    fc, merge, storage, propOf, collectSignal, requestFrame, cancelFrame,
    renderFDom, syncCanvasSize, renderRoot, context2Of, canvasAttrsOf,
    hitPath, dispatchMousePath, pointerInitOf, wheelInitOf, childrenCallback,
    setHostCanvas, setActiveCanvas, removeHostCanvas,
    setActiveEditor, disposeTextInput, registerTextInput, addGlobalMove, addGlobalUp
} './host.ts';
#import { nodeDefaults } './messages.ooc';
#import { makeNode, nodeConfig, absoluteLayoutDirection, emptyChildren, orArray } './node.ooc';
#import { createSelectionManager } './selection.ooc';
#import { when } './when.ooc';

// nil 不响应比较消息（`nil != x` 会抛错），判空一律走这个
notNil = [v => #guard v; true #else; false];

// 根节点的尺寸兜底：没有父节点，所以位置恒 0，尺寸跟随 canvas 实时尺寸
stageRootDefaults = [size => {
    x = 0,
    y = 0,
    width { (propOf $ size 'width') $ },
    height { (propOf $ size 'height') $ }
}];

stage = fc $ [ctx, props, ...children =>
    // ① 真实 canvas：id / className / style 是 DOM 属性（走 merge 兜底，缺省为 nil）
    domProps = merge $ props { id = nil, className = nil, style = nil };
    el = renderFDom $ 'canvas' (canvasAttrsOf $ (domProps id) (domProps className) (domProps style));
    setHostCanvas $ el;
    // 输入层按舞台引用计数：只有最后一个舞台销毁时才真正摘掉 textarea
    registerTextInput $;
    size = syncCanvasSize $ el;
    // 销毁回调一律写成「给对方发 destroy 消息」：宿主返回的对象可能带需要 this 的方法，
    // 直接取出来当函数调用会丢 this（编译产物的 $(fn) 用 fn 自身作 this）。
    ctx addDestroy [size destroy];
    w = propOf $ size 'width';
    h = propOf $ size 'height';

    // ② 根节点：parent 为 nil；exts / layout 是构建设置，其余消息由 props + 兜底回答
    cfg = merge $ props { exts = nil, layout = nil };
    exts0 = orArray $ (cfg exts);
    layoutDir = merge $ (cfg layout) absoluteLayoutDirection;
    strategy = merge $ props (stageRootDefaults $ size) nodeDefaults;
    childRef = storage ref emptyChildren;
    root = makeNode $ {
        parent0 = nil,
        strategy = strategy,
        childRef = childRef,
        lcRef = (storage ref nil),
        lxRef = (storage ref nil),
        lyRef = (storage ref nil),
        exts0 = exts0,
        layoutDir = layoutDir
    };

    // ③ 子树：mve-core 渲染根，target 是「子节点列表」的惰性取值，填回根节点的 children
    // 选区协调者在子树构建前就位：节点绘制 / 事件里按 parent 链反查得到的一定是本舞台
    sel = createSelectionManager $ root;
    state = renderRoot $ root nodeConfig (childrenCallback $ children);
    childRef set (propOf $ state 'target');
    ctx addDestroy [state destroy];

    // ④ 2D 上下文 + 信号收集重绘（信号变化 → 下一帧重画）
    ctx2 = context2Of $ el;
    redraw = [x => signal collect [_ => ctx2 clearRect 0 0 (w $) (h $); root draw ctx2]];
    // 每个舞台自己排队：全局 debounce 单槽在多画布页面会互相丢帧
    pendingRef = storage ref false;
    frameRef = storage ref nil;
    stopFrame = [
        id = frameRef get;
        frameRef set nil;
        pendingRef set false;
        #guard id;
        cancelFrame $ id
    ];
    scheduleRedraw = [x =>
        #guard (pendingRef get) == false;
        pendingRef set true;
        frameRef set (requestFrame $ [n =>
            pendingRef set false;
            frameRef set nil;
            redraw $ nil
        ])
    ];
    signal = collectSignal $ [x => scheduleRedraw $ nil];
    ctx addDestroy [signal destroy];
    ctx addDestroy [stopFrame];

    // ⑤ DOM 事件 → 命中链 → 节点消息（坐标相对 canvas）
    pathOf = [e => hitPath $ root (propOf $ e 'offsetX') (propOf $ e 'offsetY')];
    // hitPath 的元素是命中结果包装 { node, x, y, next }，取节点要从 node 字段读
    leafOf = [path =>
        n = path length;
        #guard (n > 0);
        path at (n - 1)
        #else;
        nil
    ];
    handleOf = [leaf =>
        #guard leaf;
        (leaf node) editorHandle
        #else;
        nil
    ];
    selOf = [leaf =>
        #guard leaf;
        (leaf node) selectable
        #else;
        nil
    ];
    dispatch = [type, e =>
        dispatchMousePath $ (pathOf $ e) (pointerInitOf $ type e)
    ];

    // 选区：按下时记录起点（双击 / 三击不进指针会话，避免压制选词结果）
    selDownIfFirst = [e, path =>
        #guard (propOf $ e 'detail') < 2;
        hit = {
            chain = (path map [it => it node]),
            x = (propOf $ e 'offsetX'),
            y = (propOf $ e 'offsetY')
        };
        sel down hit (propOf $ e 'shiftKey')
    ];
    // 双击选词 / 三击选段：换算成编辑器本地区间，走 handle.selectRange
    selectSpanAt = [leaf, x, y, paragraph =>
        h = handleOf $ leaf;
        s = selOf $ leaf;
        #guard (notNil $ h) && (notNil $ s);
        off = s positionForPoint x y;
        found = when $ paragraph (s paragraphRangeAt off) (s wordRangeAt off);
        r = when $ (notNil $ found) found (Array of 0 (s textLength));
        h selectRange (r at 0) (r at 1)
    ];

    ctx addDestroy [sel reset];
    ctx addDestroy [removeHostCanvas $ el];

    // 对齐 TS Renderer.onMouseDown：canvas 的 mousedown 默认动作会把焦点从隐藏
    // textarea 抢走（focusout → 编辑器失焦、键盘事件落到 body）。命中编辑器时必须
    // 阻止默认行为，否则单击没光标、双击有光标但照样打不了字。
    preventFocusSteal = [e, h => #guard notNil $ h; e preventDefault];

    el addEventListener 'mousedown' [e =>
        // 本舞台成为坐标换算 / 输入层定位的基准，不影响其它舞台的监听
        setActiveCanvas $ el;
        path = pathOf $ e;
        selDownIfFirst $ e path;
        dispatchMousePath $ path (pointerInitOf $ 'down' e);
        // 点击后把「命中的编辑节点」交给输入层；非编辑区则摘掉焦点
        h = handleOf $ (leafOf $ path);
        setActiveEditor $ h el;
        preventFocusSteal $ e h;
        #guard (propOf $ e 'detail') >= 3;
        selectSpanAt $ (leafOf $ path) (propOf $ e 'offsetX') (propOf $ e 'offsetY') true
    ];
    el addEventListener 'mousemove' [e => dispatch $ 'move' e];
    el addEventListener 'mouseup' [e => dispatch $ 'up' e];
    el addEventListener 'click' [e => dispatch $ 'click' e];
    el addEventListener 'dblclick' [e =>
        path = pathOf $ e;
        dispatchMousePath $ path (pointerInitOf $ 'dblclick' e);
        selectSpanAt $ (leafOf $ path) (propOf $ e 'offsetX') (propOf $ e 'offsetY') false
    ];
    el addEventListener 'contextmenu' [e => e preventDefault; dispatch $ 'contextmenu' e];
    el addEventListener 'wheel' [e =>
        consumed = dispatchMousePath $ (pathOf $ e) (wheelInitOf $ e);
        #guard consumed;
        e preventDefault
    ];
    ctx addDestroy [disposeTextInput $ el];

    // 拖选跨节点：全局移动 / 抬起（在画布外松手也能收尾）
    // 每个舞台只处理自己的会话，别把事件喂给别人的选择器
    selMove = [x, y =>
        #guard sel pressing;
        hit = {
            chain = ((hitPath $ root x y) map [it => it node]),
            x = x,
            y = y
        };
        sel move hit
    ];
    // 固定按本舞台画布换算：拖到另一块画布上方也不会把坐标串给别处
    offSelMove = addGlobalMove $ selMove el;
    ctx addDestroy [offSelMove $];
    offSelUp = addGlobalUp $ [x => sel up];
    ctx addDestroy [offSelUp $];

    // 首帧
    redraw $ nil
];

{ stage = stage }
