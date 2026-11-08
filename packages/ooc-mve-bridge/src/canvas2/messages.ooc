// 参数消息的兜底实现（对应 canvasRender2/tree/messages.ts 的 nodeMessageDefaults）。
// 约定：方法参数 = TS 参数顺序 + 末尾 node；缺省行为只向 node 再发消息。
// 节点是参数消息的接收者，`p = merge $ props nodeDefaults` —— 每条消息都答得出来，
// 所以这里不存在「检查有没有这个方法」的写法。

#import { defaultSize, defaultPosition, isNum } './host.ts';

maxZero = [v => #guard (v > 0); v #else; 0];

// 轴 → 对应 padding 消息
paddingOf = [node, d, side =>
    #guard (d == 'x');
    node paddingInline side
    #else;
    node paddingBlock side
];

// size 消息可能是数值，也可能是 { value, fromInside }（内容撑开的尺寸）
sizeOf = [node, d, s =>
    #guard (isNum $ s);
    maxZero $ s
    #else;
    insideSize $ node d s
];

insideSize = [node, d, s =>
    #guard (s fromInside);
    maxZero $ ((s value) + (paddingOf $ node d 'start') + (paddingOf $ node d 'end'))
    #else;
    maxZero $ (s value)
];

// 外尺寸：size 的结果（数值直接用；内容尺寸再加两端 padding）
outerSize = [node, d => sizeOf $ node d (node size d)];

nodeDefaults = {
    // ---- 尺寸 / 位置：默认走父布局 ----
    size(d, node) { defaultSize $ node d },
    position(d, node) { defaultPosition $ node d },
    padding(d, side, node) { 0 },
    paddingInline(side, node) { node padding 'x' side },
    paddingBlock(side, node) { node padding 'y' side },
    paddingInlineStart(node) { node paddingInline 'start' },
    paddingInlineEnd(node) { node paddingInline 'end' },
    paddingBlockStart(node) { node paddingBlock 'start' },
    paddingBlockEnd(node) { node paddingBlock 'end' },
    x(node) { node position 'x' },
    y(node) { node position 'y' },
    width(node) { outerSize $ node 'x' },
    height(node) { outerSize $ node 'y' },

    // ---- 绘制 / 命中 ----
    draw(ctx2, node) { nil },
    drawAtParent(ctx2, node) { nil },
    hide(node) { false },
    skipDraw(node) { false },
    notInLayout(node) { false },
    selectionEnabled(node) { true },
    // 可选文本能力对象（选择器遍历时问这一条）；普通节点不参与文本选择
    selectable(node) { nil },
    acceptHit(x, y, node) {
        // 半开区间：左/上含、右/下不含，避免相邻兄弟在边界双命中
        (x >= 0) && (y >= 0) && (x < (node width)) && (y < (node height))
    },
    acceptClip(x, y, node) { true },
    cursor(node) { nil },

    // ---- 焦点（本批只做读取式兜底） ----
    focusable(node) { false },
    focusOrder(node) { nil },
    focusTrap(node) { false },
    isFocused(node) { false },
    requestFocus(node) { nil },
    handleKey(key, node) { false },
    onComposing(event, node) { nil },
    debugName(node) { nil },

    // ---- 文本编辑：普通节点没有编辑器句柄 ----
    editorHandle(node) { nil },

    // ---- 鼠标钩子：默认不响应（8 种 × 捕获/冒泡） ----
    mouseClick(e, node) { nil },
    mouseDown(e, node) { nil },
    mouseUp(e, node) { nil },
    mouseMove(e, node) { nil },
    mouseWheel(e, node) { nil },
    mouseContextMenu(e, node) { nil },
    mouseDoubleClick(e, node) { nil },
    mouseClickCapture(e, node) { nil },
    mouseDownCapture(e, node) { nil },
    mouseUpCapture(e, node) { nil },
    mouseMoveCapture(e, node) { nil },
    mouseWheelCapture(e, node) { nil },
    mouseContextMenuCapture(e, node) { nil },
    mouseDoubleClickCapture(e, node) { nil }
};

{
    nodeDefaults = nodeDefaults,
    outerSize = outerSize,
    paddingOf = paddingOf
}
