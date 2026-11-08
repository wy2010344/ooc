// 节点骨架（对应 canvasRender2/tree/assemble.ts 的 nodeShell + node2）。
// 节点是普通对象：结构消息自己实现，其余参数消息逐个转到 strategy。
// strategy = merge $ props defaults —— 缺省行为由 merge 兜底，不做任何成员探测。

#import { fc, storage, memo, createLayout, absoluteLayoutFun, merge, fail, childrenCallback, flattenChildren } './host.ts';
#import { nodeDefaults } './messages.ooc';

// 默认布局方向：绝对定位（对标 Kotlin AbsoluteLayout）
absoluteLayoutDirection = { layout(d) { absoluteLayoutFun } };

orArray = [v => #guard v; v #else; (Array of)];

// 用户没给 nodeRef 时发一个没人读的 ref，保持「装配末尾统一回填」这一步不变
orRef = [v => #guard v; v #else; (storage ref nil)];

// 布局下标：在父级的 layoutChildren（已过滤 notInLayout）里取位置。
// 节点刚建、父级还没收集时取不到（-1），对齐 TS 的 _layoutIndex 初值 0，避免越界。
layoutIndexOf = [p, node =>
    lc = p layoutChildren;
    idx = lc indexOf node;
    #guard (idx >= 0);
    idx
    #else;
    0
];

// 取值前的守卫统一放在这个 lambda 里：连写的 #guard 是 if / else-if，
// 末尾的 #else 收尾，方法体里只留一句调用（否则跟在 #guard 后面的语句会被并进分支）。
layoutIndexValue = [node =>
    p = node parent;
    #guard (node hide); fail $ '已经隐藏不再显示'
    #guard (node notInLayout); fail $ '当前节点不在Layout中'
    #guard p; (layoutIndexOf $ p node)
    #else;
    0
];

// 参数消息：一律转到 strategy（= merge $ props defaults），并把 this 作为末尾实参。
// 用户写 `width = 100`（数据）或 `draw(ctx2, n) { … }`（方法）都按消息命中。
paramMessages = {
    size(d) { (this strategy) size d this },
    position(d) { (this strategy) position d this },
    padding(d, side) { (this strategy) padding d side this },
    paddingInline(side) { (this strategy) paddingInline side this },
    paddingBlock(side) { (this strategy) paddingBlock side this },
    paddingInlineStart { (this strategy) paddingInlineStart this },
    paddingInlineEnd { (this strategy) paddingInlineEnd this },
    paddingBlockStart { (this strategy) paddingBlockStart this },
    paddingBlockEnd { (this strategy) paddingBlockEnd this },
    x { (this strategy) x this },
    y { (this strategy) y this },
    width { (this strategy) width this },
    height { (this strategy) height this },
    // draw 是结构消息（见 makeNode），不在这里转发，否则会覆盖父子递归绘制
    drawAtParent(ctx2) { (this strategy) drawAtParent ctx2 this },
    hide { (this strategy) hide this },
    skipDraw { (this strategy) skipDraw this },
    notInLayout { (this strategy) notInLayout this },
    selectionEnabled { (this strategy) selectionEnabled this },
    selectable { (this strategy) selectable this },
    acceptHit(x, y) { (this strategy) acceptHit x y this },
    acceptClip(x, y) { (this strategy) acceptClip x y this },
    cursor { (this strategy) cursor this },
    focusable { (this strategy) focusable this },
    focusOrder { (this strategy) focusOrder this },
    focusTrap { (this strategy) focusTrap this },
    isFocused { (this strategy) isFocused this },
    requestFocus { (this strategy) requestFocus this },
    handleKey(key) { (this strategy) handleKey key this },
    onComposing(event) { (this strategy) onComposing event this },
    editorHandle { (this strategy) editorHandle this },
    debugName { (this strategy) debugName this },
    mouseClick(e) { (this strategy) mouseClick e this },
    mouseDown(e) { (this strategy) mouseDown e this },
    mouseUp(e) { (this strategy) mouseUp e this },
    mouseMove(e) { (this strategy) mouseMove e this },
    mouseWheel(e) { (this strategy) mouseWheel e this },
    mouseContextMenu(e) { (this strategy) mouseContextMenu e this },
    mouseDoubleClick(e) { (this strategy) mouseDoubleClick e this },
    mouseClickCapture(e) { (this strategy) mouseClickCapture e this },
    mouseDownCapture(e) { (this strategy) mouseDownCapture e this },
    mouseUpCapture(e) { (this strategy) mouseUpCapture e this },
    mouseMoveCapture(e) { (this strategy) mouseMoveCapture e this },
    mouseWheelCapture(e) { (this strategy) mouseWheelCapture e this },
    mouseContextMenuCapture(e) { (this strategy) mouseContextMenuCapture e this },
    mouseDoubleClickCapture(e) { (this strategy) mouseDoubleClickCapture e this }
};

// children 的初始值：装配完成前节点答出空表（对应 TS 的 emptyChildren）
emptyChildren = [Array of];

// 子表达式展平 + 过滤 hide（对应 canvasRender2 的 nodeConfig）
nodeConfig = {
    after(list) { nil },
    purifyList(list) {
        out = Array of;
        flattenChildren $ list out;
        out
    }
};

// 每个节点自带三份延迟缓存（layoutChildren / layoutX / layoutY 的 memo）
makeNode = [cfg =>
    parent0 = cfg parent0;
    strategy = cfg strategy;
    childRef = cfg childRef;
    lcRef = cfg lcRef;
    lxRef = cfg lxRef;
    lyRef = cfg lyRef;
    exts0 = cfg exts0;
    layoutDir = cfg layoutDir;
    ({
        parent = parent0,
        strategy = strategy,
        // children 是可写状态：装配完成后由 childRef 写入真实子表达式
        children { ((childRef get) $) },
        findExt(cls) { exts0 find [it => cls include it] },
        index {
            #guard (this hide); fail $ '已经隐藏不再显示'
            #guard parent0;
            (parent0 children) indexOf this
            #else;
            0
        },
        draw(ctx2) {
            (this strategy) draw ctx2 this;
            (this children) forEach [child =>
                #guard ((child skipDraw) == false);
                ctx2 save;
                child drawAtParent ctx2;
                ctx2 translate (child x) (child y);
                child draw ctx2;
                ctx2 restore
            ]
        },
        layoutChildren {
            cached = lcRef get;
            #guard cached;
            cached $
            #else;
            // children 必须在 memo 内部读取：放在外面会闭包住首次的数组，
            // 之后列表增删都不会重算（新行下标越界 → StackLayout childPosition 取到 undefined）。
            // lambda 内的 this 不是节点，先落到 node 变量再闭包。
            node = this;
            fresh = memo $ [ (node children) filter [n => (n notInLayout) == false] ];
            lcRef set fresh;
            fresh $
        },
        layoutIndex { layoutIndexValue $ this },
        layout(d) { layoutDir layout d },
        layoutX {
            cached = lxRef get;
            #guard cached;
            cached $
            #else;
            fresh = createLayout $ this 'x';
            lxRef set fresh;
            fresh $
        },
        layoutY {
            cached = lyRef get;
            #guard cached;
            cached $
            #else;
            fresh = createLayout $ this 'y';
            lyRef set fresh;
            fresh $
        },
        ...paramMessages
    })
];

// 通用装配：cfg 只装构建设置（ctx / parent / strategy / props / children / renderer）。
buildNode = [op =>
    ctx = op ctx;
    props = op props;
    cfg = merge $ props { exts = nil, layout = nil, nodeRef = nil };
    exts0 = orArray $ (cfg exts);
    layoutDir = merge $ (cfg layout) absoluteLayoutDirection;
    ref = orRef $ (cfg nodeRef);
    childRef = storage ref emptyChildren;
    node = makeNode $ {
        parent0 = (op parent),
        strategy = (op strategy),
        childRef = childRef,
        lcRef = (storage ref nil),
        lxRef = (storage ref nil),
        lyRef = (storage ref nil),
        exts0 = exts0,
        layoutDir = layoutDir
    };
    // 节点先成型（已能作为父节点回答消息），再接真实子表达式
    childRef set ((op renderer) $ node (childrenCallback $ (op children)));
    // 装配末尾把句柄指回节点（对应 TS `nodeRef.set(node)`）
    ref set node;
    node
];

// 普通节点的子表达式承载：交给 mve-core 的 renderNode
rendererOf = [ctx => [n, cb => ctx renderNode n cb nodeConfig]];

// 最普通的节点工厂：参数消息 + 子节点
node2 = fc $ [ctx, props, ...children =>
    node = buildNode $ {
        ctx = ctx,
        parent = (ctx getParent),
        strategy = (merge $ props nodeDefaults),
        props = props,
        children = children,
        renderer = (rendererOf $ ctx)
    };
    ctx addNode node;
    node
];

{
    nodeDefaults = nodeDefaults,
    nodeConfig = nodeConfig,
    buildNode = buildNode,
    rendererOf = rendererOf,
    node2 = node2,
    absoluteLayoutDirection = absoluteLayoutDirection,
    emptyChildren = emptyChildren,
    orArray = orArray
}
