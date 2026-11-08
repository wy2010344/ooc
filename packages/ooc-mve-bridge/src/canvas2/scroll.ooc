// 滚动几何 / 内容节点 / 覆盖式滚动条（对标 canvasRender2 的 Scroll.ts + OverlayScrollBar.ts）。
// 容器装配在 scroll-box.ooc；这里只放可独立复用的部分：
// 内容节点滚动、滑块 / 轨道几何、覆盖式滚动条的自有消息。
// 几何口径与 TS 一致：thumb = min(max(minThumb, viewport*full/content), viewport)，
// offset = (viewport - thumb) * value / maxScroll，滑块贴边留白 edgeGap。

#import {
    storage, merge, colorToCSS, roundRectPath, absoluteX, absoluteY,
    dragPointer, defaultPosition
} './host.ts';
#import { when } './when.ooc';
#import { nodeDefaults } './messages.ooc';

maxZero = [v => #guard (v > 0); v #else; 0];
maxOf = [a, b => #guard (a > b); a #else; b];
minOf = [a, b => #guard (a < b); a #else; b];
cap1 = [v => #guard (v > 1); 1 #else; v];

// 容器 inner（不含 padding）；负值归零，避免把节点画到外面
innerXOf = [node => maxZero $ (((node width) - (node paddingInlineStart)) - (node paddingInlineEnd))];
innerYOf = [node => maxZero $ (((node height) - (node paddingBlockStart)) - (node paddingBlockEnd))];

contentHeightOf = [content => (content height)];
scrollMaxOf = [node, content => maxZero $ ((contentHeightOf $ content) - (innerYOf $ node))];

clampScroll = [v, hi => #guard (v > hi); hi #else; (maxZero $ v)];

// ---- 滚动条几何（对应 OverlayScrollBar 的 thumb / track 计算） ----
// 内容不超过视口时整条隐藏
hasBarOf = [node, content => (contentHeightOf $ content) > (innerYOf $ node)];
trackHOf = [node, p => maxZero $ ((innerYOf $ node) - ((p trackInset) * 2))];

thumbHOf = [node, content, p =>
    viewH = innerYOf $ node;
    contentH = contentHeightOf $ content;
    viewport = trackHOf $ node p;
    #guard ((contentH > 0) && (viewH > 0)) && (viewport > 0);
    minOf $ viewport (maxOf $ (p minThumb) ((viewport * viewH) div contentH))
    #else;
    0
];

thumbYOf = [node, content, value, p =>
    hi = scrollMaxOf $ node content;
    trackH = trackHOf $ node p;
    h = thumbHOf $ node content p;
    #guard (hi > 0) && (trackH > 0);
    (p trackInset) + (((trackH - h) * (clampScroll $ value hi)) div hi)
    #else;
    p trackInset
];

// 贴边感应带（画布坐标）：不可滚动时没有感应带
inBandOf = [node, content, x, y =>
    bx = absoluteX $ node;
    by = absoluteY $ node;
    #guard (hasBarOf $ node content);
    (x >= bx) && (x <= (bx + (node width))) && (y >= by) && (y <= (by + (node height)))
];

// ---- 共享状态：滚动值 + 活动通知（滚轮时滚动条唤出） ----
makeScrollState = [sig =>
    listenersRef = storage ref (Array of);
    {
        value { sig get },
        set(v) { sig set v },
        addListener(fn) {
            list = listenersRef get;
            listenersRef set (list toSpliced (list length) 0 fn)
        },
        clear { listenersRef set (Array of) },
        notify { (listenersRef get) forEach [fn, i => fn $] }
    }
];

// 内容节点自有消息（state = 滚动值；contentRef 指向内容自己）
scrollContentOwn = [state, contentRef => {
    draw(ctx2, node) { nil },
    // 滚动轴位置 = 父 padding 起点 - 滚动值；交叉轴交给父布局
    position(d, node) {
        parent = node parent;
        #guard (d == 'y');
        (parent paddingBlockStart) - (clampScroll $ (state value) (scrollMaxOf $ parent (contentRef get)))
        #else;
        defaultPosition $ node d
    },
    // 命中门控：只允许落在视口（父 inner）内
    acceptClip(x, y, node) {
        parent = node parent;
        left = parent paddingInlineStart;
        top = parent paddingBlockStart;
        (x > left) && (y > top) && (x < (left + (innerXOf $ parent))) && (y < (top + (innerYOf $ parent)))
    },
    // 父坐标系的裁剪：父节点 draw 循环在 translate 前调用
    drawAtParent(ctx2, node) {
        parent = node parent;
        ctx2 beginPath;
        ctx2 rect (parent paddingInlineStart) (parent paddingBlockStart) (innerXOf $ parent) (innerYOf $ parent);
        ctx2 clip
    },
    mouseWheel(e, node) {
        delta = e wheelDeltaY;
        parent = node parent;
        #guard (delta != 0);
        state set (clampScroll $ ((state value) + delta) (scrollMaxOf $ parent (contentRef get)));
        state notify;
        e stopPropagation
    }
}];

// 滚动条参数不散着传：p / state / contentRef / ui 合成一个对象
scrollBarOwn = [op =>
    p = op p;
    state = op state;
    contentRef = op contentRef;
    ui = op ui;
    startValueRef = storage ref 0;
    startYRef = storage ref 0;

    // 按下：落在滑块上拖拽，落在轨道空白处整页滚动（与 TS mouseDown 一致）
    thumbDown = [parent, content, e =>
        iy = e y;
        hi = scrollMaxOf $ parent content;
        h = thumbHOf $ parent content p;
        top = thumbYOf $ parent content (state value) p;
        hit = ((hi > 0) && (h > 0)) && ((iy >= top) && (iy <= (top + h)));
        #guard hit;
        (ui draggingRef) set true;
        ui showNow;
        startValueRef set (state value);
        startYRef set (e globalY);
        dragPointer $ {
            onMove = [x, y =>
                travel = (trackHOf $ parent p) - h;
                #guard travel > 0;
                state set (clampScroll $ ((startValueRef get) + (((y - (startYRef get)) * hi) div travel)) hi)
            ],
            onEnd = [x =>
                (ui draggingRef) set false;
                ui hideSoon
            ]
        }
        #else;
        // 与 TS 一致：先按轨道高取至少 40，再乘 0.9（整页）
        step = (maxOf $ 40 (trackHOf $ parent p)) * 0.9;
        dir = when $ (iy < top) (0 - 1) 1;
        state set (clampScroll $ ((state value) + (dir * step)) hi);
        state notify
    ];

    // 画滑块：不可滚动 / 无颜色 / 完全透明时都不画
    paintBar = [parent, content, ctx2 =>
        h = thumbHOf $ parent content p;
        a = ui alpha;
        ok = ((h > 0) && ((p thumbColor) != nil)) && (a > 0.004);
        #guard ok;
        w = ui barWidth;
        x = ((p barHitWidth) - (p barGap)) - w;
        y = thumbYOf $ parent content (state value) p;
        ctx2 save;
        ctx2 globalAlpha a;
        ctx2 fillStyle (colorToCSS $ (p thumbColor));
        roundRectPath $ ctx2 x y w h (w div 2);
        ctx2 fill;
        ctx2 restore
    ];

    ({
        size(d, node) {
            #guard (d == 'y');
            innerYOf $ (node parent)
            #else;
            p barHitWidth
        },
        position(d, node) {
            parent = node parent;
            #guard (d == 'x');
            ((parent width) - (parent paddingInlineEnd)) - (p barHitWidth)
            #else;
            parent paddingBlockStart
        },
        notInLayout(node) { true },
        acceptClip(x, y, node) { true },
        // 静止淡出时整条不可见，点击直接穿透到内容（与 TS alphaOf <= 0.02 一致）
        // 注意：不能连写两个 #guard（是 if/else-if，会把后一个 guard 的 nil 当结果返回）
        acceptHit(x, y, node) {
            parent = node parent;
            (((hasBarOf $ parent (contentRef get)) && (ui visible)) && ((p thumbColor) != nil)) && ((x >= 0) && (x <= (p barHitWidth)))
        },
        mouseDown(e, node) {
            parent = node parent;
            content = contentRef get;
            #guard (hasBarOf $ parent content);
            thumbDown $ parent content e;
            e stopPropagation
        },
        mouseWheel(e, node) {
            parent = node parent;
            delta = e wheelDeltaY;
            #guard (delta != 0);
            state set (clampScroll $ ((state value) + delta) (scrollMaxOf $ parent (contentRef get)));
            state notify;
            e stopPropagation
        },
        draw(ctx2, node) {
            parent = node parent;
            content = contentRef get;
            #guard (hasBarOf $ parent content);
            paintBar $ parent content ctx2
        }
    })
];

// 容器参数兜底（纯字面量直接绑数据属性；跟随信号的成员由页面写成方法）
scrollDefaults = {
    height = 200,
    gap = 0,
    radius = 0,
    background = nil,
    borderColor = nil,
    borderWidth = 0,
    paddingInlineStart = 0,
    paddingInlineEnd = 0,
    paddingBlockStart = 0,
    paddingBlockEnd = 0,
    thumbColor = nil,
    barWidth = 6,
    barHoverWidth = 10,
    barHitWidth = 12,
    barGap = 3,
    trackInset = 4,
    minThumb = 28,
    idleAlpha = 0.3,
    hoverAlpha = 0.45,
    dragAlpha = 0.62,
    idleDelayMs = 850,
    fadeInMs = 110,
    fadeOutMs = 320,
    draw(ctx2, node) { nil }
};

{
    scrollDefaults = scrollDefaults,
    scrollContentOwn = scrollContentOwn,
    scrollBarOwn = scrollBarOwn,
    makeScrollState = makeScrollState,
    hasBarOf = hasBarOf,
    inBandOf = inBandOf,
    scrollMaxOf = scrollMaxOf,
    clampScroll = clampScroll
}
