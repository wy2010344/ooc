// 滚动容器装配：盒子(rect) → [内容节点, 覆盖式滚动条]。
// 观感三态在这里统一驱动（静止淡出 0.3 / 悬停 0.45 + 加粗 / 拖拽 0.62），
// 几何与节点消息在 scroll.ooc。
//
// 用法：`(scrollBox $ { height = 352, gap = 6, thumbColor { … } } children…) ctx`

#import {
    fc, storage, merge, createSignal, flex, grow2, addGlobalMove, delay,
    requestFrame, cancelFrame, nowMs
} './host.ts';
#import {
    scrollDefaults, scrollContentOwn, scrollBarOwn, makeScrollState, inBandOf
} './scroll.ooc';
#import { nodeDefaults } './messages.ooc';
#import { buildNode, rendererOf } './node.ooc';
#import { rect } './rect.ooc';

cap1 = [v => #guard (v > 1); 1 #else; v];

scrollBox = fc $ [ctx, props, ...children =>
    p = merge $ props scrollDefaults;
    sig = createSignal $ 0;
    state = makeScrollState $ sig;
    contentRef = storage ref nil;
    barRef = storage ref nil;
    hoverRef = createSignal $ false;
    draggingRef = createSignal $ false;
    // 淡入淡出进度 0~1（滚动 / 悬停唤起，停手后淡出）
    fadeRef = createSignal $ 0;
    fadeRafRef = storage ref nil;
    stepRef = storage ref nil;
    timerRef = storage ref nil;

    stopTimer = [x =>
        prev = timerRef get;
        timerRef set nil;
        #guard prev;
        prev $
    ];

    stopFade = [x =>
        id = fadeRafRef get;
        fadeRafRef set nil;
        #guard id;
        cancelFrame $ id
    ];

    // 0→1 逐帧插值；ms <= 0 直接落终值
    fadeTo = [target, ms =>
        stopFade $ nil;
        from = fadeRef get;
        start = nowMs $;
        span = target - from;
        stepRef set [ts =>
            t = cap1 $ (((nowMs $) - start) div ms);
            fadeRef set (from + (span * t));
            #guard t < 1;
            fadeRafRef set (requestFrame $ (stepRef get))
        ];
        #guard (from != target) && (ms > 0);
        fadeRafRef set (requestFrame $ (stepRef get))
        #else;
        fadeRef set target
    ];

    // 停手后淡出；指针仍停在滚动条上时不安排（悬停即常驻）
    scheduleHide = [x =>
        stopTimer $ nil;
        #guard (hoverRef get) == false;
        timerRef set (delay $ (p idleDelayMs) [i =>
            #guard (draggingRef get) == false;
            fadeTo $ 0 (p fadeOutMs)
        ])
    ];

    // 唤起：只负责淡入，是否收起由调用方决定
    wake = [x =>
        #guard (fadeRef get) < 1;
        fadeTo $ 1 (p fadeInMs)
    ];

    // 滚轮活动：浮现并安排淡出
    revealIn = [x =>
        #guard (draggingRef get) == false;
        wake $ nil;
        scheduleHide $ nil
    ];

    showNowIn = [x =>
        stopTimer $ nil;
        fadeTo $ 1 0
    ];

    // 滚动条内部共享：悬停 / 拖拽 / 宽度与透明度 / 唤出与收起
    ui = {
        hoverRef = hoverRef,
        draggingRef = draggingRef,
        // 与 TS alphaOf 一致：拖拽 / 悬停恒为 1，静止跟随淡入淡出进度
        activity {
            #guard (draggingRef get) || (hoverRef get);
            1
            #else;
            fadeRef get
        },
        alpha {
            #guard (draggingRef get);
            p dragAlpha
            #guard (hoverRef get);
            p hoverAlpha
            #else;
            (fadeRef get) * (p idleAlpha)
        },
        // 是否拦指针：静止淡出后点击穿透到内容
        visible { (draggingRef get) || (hoverRef get) || ((fadeRef get) > 0.02) },
        barWidth {
            #guard (hoverRef get) || (draggingRef get);
            p barHoverWidth
            #else;
            p barWidth
        },
        reveal { revealIn $ nil },
        showNow { showNowIn $ nil },
        hideSoon { scheduleHide $ nil }
    };

    // 滚轮活动 → 滚动条唤出
    state addListener [x => revealIn $ nil];

    // 全局鼠标移动 → 贴边感应带判定（指针离开 bar 也能收到）
    hoverIn = [x, y =>
        node = barRef get;
        content = contentRef get;
        #guard node && content;
        inBandOf $ node content x y
    ];
    wakeOrSleep = [v =>
        #guard v;
        wake $ nil
        #else;
        scheduleHide $ nil
    ];
    updateHover = [x, y =>
        was = hoverRef get;
        v = hoverIn $ x y;
        hoverRef set v;
        #guard v != was;
        wakeOrSleep $ v
    ];
    offMove = addGlobalMove $ updateHover;

    ctx addDestroy offMove;
    ctx addDestroy [state clear];
    ctx addDestroy [stopTimer $ nil];
    ctx addDestroy [stopFade $ nil];

    // 盒子：横排单个内容，交叉轴 stretch + alignFix（内容宽度由父级分配）
    boxProps = merge $ props { layout = (flex $ { direction = 'x', alignItem = 'stretch', alignFix = true }) };
    contentCfg = {
        layout = (flex $ { direction = 'y', gap = (p gap), alignItem = 'stretch', alignFix = true }),
        exts = (Array of (grow2 $ { argGrow = 1 }))
    };
    boxChildren = [c =>
        parent = c getParent;
        content = buildNode $ {
            ctx = c,
            parent = parent,
            strategy = (merge $ (scrollContentOwn $ state contentRef) nodeDefaults),
            props = contentCfg,
            children = children,
            renderer = (rendererOf $ c)
        };
        c addNode content;
        contentRef set content;
        // 滚动条后加：绘制在上层，命中链里也先被问到（命中自末尾向前）
        bar = buildNode $ {
            ctx = c,
            parent = parent,
            strategy = (merge $ (scrollBarOwn $ { p = p, state = state, contentRef = contentRef, ui = ui }) nodeDefaults),
            props = { layout = nil },
            children = (Array of),
            renderer = (rendererOf $ c)
        };
        c addNode bar;
        barRef set bar;
        content
    ];
    (rect $ boxProps boxChildren) $ ctx
];

{ scrollBox = scrollBox }
