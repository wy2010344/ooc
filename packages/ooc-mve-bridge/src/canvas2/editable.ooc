// 可编辑富文本组件（对标 canvasRender2/EditableTextNode.ts）。
// 用法：`handle = (editable $ { text { textSignal $ }, onTextChange(v) { textSignal $ v }, width = 520 } ) ctx`
// 返回编辑器句柄（工具栏 / 外部按消息调用）；节点通过 editorHandle 暴露给舞台。
// 编辑能力：富文本样式段、光标 / 选区、软换行、拖选、键盘、IME、撤销 / 重做。

#import {
    fc, storage, merge, memo, repeatEvery, syncInputPosition,
    createSignal, absoluteX, absoluteY, paraWidth, paraHeight, paraGlyphAt, paraCaretRect,
    buildRichParagraph, defaultSize
} './host.ts';
#import { nodeDefaults } './messages.ooc';
#import { buildNode, rendererOf } './node.ooc';
#import { alignIn } './segments.ooc';
#import { spansOfIn } './text-style.ooc';
#import { editorDefaults, lineHeightOf, innerWidthOf, drawEditorIn } './editable-view.ooc';
#import { toggleIn } './editable-style.ooc';
#import { makeHandleIn } './editable-handle.ooc';
#import { makeSelectableOf } './editable-select.ooc';
#import { selectionRangeOf, managerOfNode } './selection.ooc';
#import { when } './when.ooc';

minOf = [a, b => #guard (a < b); a #else; b];
maxOf = [a, b => #guard (a > b); a #else; b];
maxZero = [v => #guard (v > 0); v #else; 0];
// 有外部区间就用它，否则退回本地光标（when 是急求值，不能直接取 ext at 0）
rangeLoOf = [r, fallback => #guard r; r at 0 #else; fallback];
rangeHiOf = [r, fallback => #guard r; r at 1 #else; fallback];
insideSizeOf = [v => { value = v, fromInside = true }];
orEmpty = [v => #guard v; v #else; (Array of)];
// 回收站式快照：文本 + 选区 + 段（样式）
pushSnapIn = [ref, snap =>
    list = ref get;
    next = list toSpliced (list length) 0 snap;
    ref set (when $ ((next length) > 80) (next slice 1 (next length)) next)
];
callIf = [fn => #guard fn; fn $];
editable = fc $ [ctx, props, ...children =>
    p = merge $ props editorDefaults;
    nodeRef = storage ref nil;
    selRef = storage ref (Array of 0 0);
    segRef = storage ref (orEmpty $ (p segments));
    paraRef = storage ref nil;
    focusRef = storage ref false;
    blinkRef = storage ref true;
    blinkTimerRef = storage ref nil;
    preferredXRef = storage ref nil;
    undoRef = storage ref (Array of);
    redoRef = storage ref (Array of);
    composingBaseRef = storage ref nil;
    pendingRef = storage ref nil; // 待输入样式：塌缩光标时工具栏改它，下次输入落进插入区
    // 选区 / 光标闪烁不是信号，画布不会自己重画：用这个计数信号把它们接进收集器
    dirtySig = createSignal $ 0;
    bump = [dirtySig set ((dirtySig get) + 1)];
    // 样式段存在 ref 里（不是信号）：段落排版要跟着段变化重排，用这个版本号接进依赖
    segSig = createSignal $ 0;
    touchSegs = [segSig set ((segSig get) + 1)];

    // ---- 段落：memo 跟随 text 信号 / 段版本；宽度取自节点内容盒 ----
    paraBuild = [node1 =>
        // 先读一次段版本：样式段变化（B/I/U/颜色）会让排版失效
        segSig get;
        #guard node1;
        buildRichParagraph $ {
            spans = (spansOfIn $ { text = (p text), segments = (segRef get), p = p }),
            maxWidth = (innerWidthOf $ node1),
            singleLine = (p singleLine),
            emptyHeight = (lineHeightOf $ p)
        }
        #else;
        buildRichParagraph $ {
            spans = (Array of),
            maxWidth = 1,
            singleLine = (p singleLine),
            emptyHeight = (lineHeightOf $ p)
        }
    ];
    paraOf = [cached = paraRef get; #guard cached; cached $ #else; fresh = memo $ [(paraBuild $ (nodeRef get))]; paraRef set fresh; fresh $];

    // 单行横向滚动：只由光标位置推导（无需额外状态）
    // 两级条件拆成两个函数：同层的多个 #guard 是 else-if，命中即返回
    scrollXOfSingle = [node, para, index =>
        r = paraCaretRect $ para index;
        #guard r;
        inner = innerWidthOf $ node;
        limit = maxZero $ ((paraWidth $ para) - inner);
        minOf $ limit (maxZero $ (((r at 0) + 2) - inner))
        #else;
        0
    ];
    scrollXOf = [node, para, index =>
        #guard (p singleLine);
        scrollXOfSingle $ node para index
        #else;
        0
    ];

    // ---- 可选文本能力：向全局选择器报名（跨节点拖选由它推导两端） ----
    selectableObj = makeSelectableOf $ {
        p = p,
        selRef = selRef,
        paraOf = paraOf,
        nodeRef = nodeRef,
        scrollXOf = scrollXOf
    };
    // 选区协调者按节点反查：同一页面多个舞台各有自己的真相
    selMgr = [x => managerOfNode $ (nodeRef get)];
    // 聚焦时把本地光标发布给选择器：非塌缩区间会压过已定格的指针选区
    publishNow = [x =>
        #guard focusRef get;
        mgr = selMgr $;
        pair = {
            anchor = { node = selectableObj, offset = ((selRef get) at 0) },
            focus = { node = selectableObj, offset = ((selRef get) at 1) }
        };
        mgr setActive pair
    ];

    // ---- 选区 / 文本 / 历史 ----
    setSel = [a, f =>
        selRef set (Array of a f);
        publishNow $ nil;
        bump $;
        syncInputPosition $
    ];
    // 快照必须「立刻取值」：对象成员写计算式会变成惰性 getter，
    // 等撤销时再读拿到的是当前文本，撤销就成了空操作
    snapNow = [
        t = (p text);
        sel = selRef get;
        s = segRef get;
        obj = { text = t, a = (sel at 0), f = (sel at 1), segs = s };
        obj
    ];
    pushUndo = [pushSnapIn $ undoRef (snapNow $); redoRef set (Array of)];
    restoreSnap = [snap =>
        p onTextChange (snap text);
        segRef set (snap segs);
        touchSegs $;
        p onSegmentsChange (snap segs);
        selRef set (Array of (snap a) (snap f));
        publishNow $ nil;
        bump $;
        syncInputPosition $
    ];
    undo = [list = undoRef get; #guard (list length) > 0; last = list at ((list length) - 1); undoRef set (list slice 0 ((list length) - 1)); pushSnapIn $ redoRef (snapNow $); restoreSnap $ last];
    redo = [list = redoRef get; #guard (list length) > 0; last = list at ((list length) - 1); redoRef set (list slice 0 ((list length) - 1)); pushSnapIn $ undoRef (snapNow $); restoreSnap $ last];
    updateText = [next =>
        old = p text;
        p onTextChange next;
        #guard old != next;
        nextSeg = alignIn $ { list = (segRef get), oldText = old, newText = next, insertStyle = (pendingRef get) };
        segRef set nextSeg;
        touchSegs $;
        p onSegmentsChange nextSeg
    ];

    // 键盘操作前把外部（跨节点）选区收成本地光标，此后按本地状态编辑
    adoptIn = [x =>
        r = selectionRangeOf $ selectableObj;
        #guard r;
        selRef set r;
        mgr = selMgr $;
        mgr clearPointer;
        bump $ nil
    ];

    // 输入层定位：光标矩形（视口坐标）。节点一定存在，故只需再判一次光标
    overlayCore = [node, para, index =>
        r = paraCaretRect $ para index;
        #guard r;
        sx = scrollXOf $ node para index;
        left = absoluteX $ node;
        top = absoluteY $ node;
        out = {
            x = ((left + (node paddingInlineStart)) - sx) + (r at 0),
            y = ((top + (node paddingBlockStart)) + (r at 1)),
            w = 2,
            h = maxZero $ ((r at 3) - (r at 1)),
            fontSize = (p fontSize)
        };
        out
        #else;
        nil
    ];

    // ---- 样式变更 / IME 在 editable-style.ooc（统一接收 env） ----

    // 键盘 Ctrl+B / I / U 复用工具栏同一条开关（read 读取当前段样式标志）
    envToggle = [read, patch => toggleIn $ env read patch];
    env = {
        p = p,
        segRef = segRef,
        composingBaseRef = composingBaseRef,
        pendingRef = pendingRef,
        selRef = selRef,
        preferredXRef = preferredXRef,
        paraOf = paraOf,
        pushUndo = pushUndo,
        updateText = updateText,
        setSel = setSel,
        undo = undo,
        redo = redo,
        // 样式段改写后：通知排版失效 + 画布重绘
        touchSegs = touchSegs,
        bump = bump,
        toggleStyle = envToggle
    };

    // 光标闪烁：只在聚焦时跑；每 530ms 翻转
    blinkTick = [blinkRef set ((blinkRef get) == false); bump $];
    stopBlink = [prev = blinkTimerRef get; blinkTimerRef set nil; callIf $ prev];
    startBlink = [stopBlink $; blinkRef set true; blinkTimerRef set (repeatEvery $ 530 blinkTick)];

    // ---- 对外句柄：消息面在 editable-handle.ooc（工具栏 / 输入层 / 舞台） ----
    handleEnv = {
        editEnv = env,
        p = p,
        selectable = selectableObj,
        selMgr = selMgr,
        nodeRef = nodeRef,
        selRef = selRef,
        focusRef = focusRef,
        undoRef = undoRef,
        redoRef = redoRef,
        composingBaseRef = composingBaseRef,
        pendingRef = pendingRef,
        bump = bump,
        paraOf = paraOf,
        overlayCore = overlayCore,
        setSel = setSel,
        startBlink = startBlink,
        stopBlink = stopBlink,
        publishNow = publishNow,
        adoptIn = adoptIn,
        undo = undo,
        redo = redo
    };
    handle = makeHandleIn $ handleEnv;

    editorOwn = {
        size(d, node) {
            #guard (d == 'x');
            defaultSize $ node 'x'
            #else;
            insideSizeOf $ (paraHeight $ (paraOf $))
        },
        draw(ctx2, node) {
            // 读一次 dirty / 全局选区版本：选区与闪烁变化都靠它驱动重画
            dirtySig get;
            para = paraOf $;
            local = selRef get;
            ext = selectionRangeOf $ selectableObj;
            lo = rangeLoOf $ ext (minOf $ (local at 0) (local at 1));
            hi = rangeHiOf $ ext (maxOf $ (local at 0) (local at 1));
            drawEditorIn $ {
                ctx2 = ctx2,
                p = p,
                node = node,
                para = para,
                scrollX = (scrollXOf $ node para (local at 1)),
                selStart = lo,
                selEnd = hi,
                caretIndex = (local at 1),
                focused = (focusRef get),
                blink = (blinkRef get)
            }
        },
        mouseDown(e, node) {
            para = paraOf $;
            sx = scrollXOf $ node para ((selRef get) at 1);
            x = ((e x) - (node paddingInlineStart)) + sx;
            y = (e y) - (node paddingBlockStart);
            index = paraGlyphAt $ para x y;
            preferredXRef set nil;
            focusRef set true;
            startBlink $;
            // 拖选由舞台级选择器接管（可跨节点），这里只落光标
            setSel $ index index
        },
        selectable(node) { selectableObj },
        editorHandle(node) { handle }
    };

    node = buildNode $ {
        ctx = ctx,
        parent = (ctx getParent),
        // editorOwn 在前：绘制 / 命中 / 尺寸归编辑器；p 提供 width / padding 等节点参数
        strategy = (merge $ editorOwn p nodeDefaults),
        props = (merge $ props { nodeRef = nodeRef }),
        children = (Array of),
        renderer = (rendererOf $ ctx)
    };
    ctx addNode node;
    ctx addDestroy [handle destroy];
    // 句柄出口：走回调（props 的 `=` 成员经 merge 读会把函数值当方法空调用）
    p setHandle handle;
    node
];

{ editable = editable, editorDefaults = editorDefaults }
