// 选区协调者：每个舞台一份（对标 canvasRender2/selection/manager.ts 的
// createSelectionManager(source)）。单一真相：指针会话 / 编辑器本地光标 /
// 程序化指令三路按优先级派生，节点只按 rangeOf 读取自己那一份区间来画高亮。
//
// 模块级只留纯函数 + 一张「根节点 → 协调者」注册表；所有可变状态都在
// createSelectionManager 的闭包里。两个舞台并存时各自独立，销毁互不影响。
//
// 节点报名方式：实现一条 `selectable` 消息返回能力对象（缺省在 messages.ooc 里给 nil），
// 能力对象 merge $ 自己的实现 selectableDefaults，并回答 ownerNode 供反查所属舞台。
//
// 定义顺序有讲究：顶层 lambda 只捕获「定义时已存在」的绑定，工厂必须排在
// 它引用的所有纯函数之后、而排在需要反向创建它的兜底逻辑之前。

#import { storage, createSignal } './host.ts';
#import { when } './when.ooc';

minOf = [a, b => #guard (a < b); a #else; b];
maxOf = [a, b => #guard (a > b); a #else; b];
clampTo = [v, lo, hi => minOf $ hi (maxOf $ lo v)];
// nil 不响应比较消息（`nil != x` 会抛「没有定义该方法 !=」），统一用这两个判断
hasOf = [v => #guard v; true #else; false];
isNilOf = [v => #guard v; false #else; true];
// 对象身份比较：节点对象没有 `==` 方法，借数组 indexOf（严格相等）判断
sameOf = [a, b => ((Array of a) indexOf b) == 0];
// 取上一次按下的命中点；没有就返回 nil（when 是急求值，必须走 guard 兜底）
pressOf = [prev => #guard prev; prev press #else; nil];

// 两条消息都答得出来：没有分词 / 分段能力的实现 merge 它即可
selectableDefaults = {
    wordRangeAt(offset) { nil },
    paragraphRangeAt(offset) { nil }
};

// ---- 可选集合：文档序前序遍历；selectionEnabled 为 false 剪掉整棵子树 ----
// 自递归靠参数传自己：顶层 lambda 的作用域在定义时还没有自身的绑定，
// 直接写 `collectOf $ child` 在解释器里会报 not found define。
collectOf = [node, self =>
    (node children) reduce [acc, child =>
        #guard child selectionEnabled;
        sel = child selectable;
        base = when $ (hasOf $ sel) (acc toSpliced (acc length) 0 sel) acc;
        base concat (self $ child self)
        #else;
        acc
    ] (Array of)
];

// ---- 命中快照 → 端点（链从深到浅找第一个在册可选节点） ----
// list 由所属舞台给出：跨舞台不会串到别人的可选节点上
nodeOfHit = [hit, list =>
    chain = hit chain;
    (chain toReversed) find [n => (list indexOf (n selectable)) >= 0]
];

pointCoreOf = [hit, list =>
    node = nodeOfHit $ hit list;
    #guard node;
    sel = node selectable;
    {
        node = sel,
        offset = clampTo $ (sel positionForPoint (hit x) (hit y)) 0 (sel textLength)
    }
    #else;
    nil
];

pointOf = [hit, list =>
    #guard hit;
    pointCoreOf $ hit list
    #else;
    nil
];

pointerPairOf = [s, list, move =>
    a = pointOf $ (s press) list;
    #guard a;
    b = when $ (hasOf $ (s release)) (pointOf $ (s release) list) (pointOf $ move list);
    { anchor = a, focus = (when $ (hasOf $ b) b a) }
];

pairPressed = [s => #guard s; isNilOf $ (s release) #else; false];
pairFrozen = [s => #guard s; hasOf $ (s release) #else; false];
pairExpanded = [cp => #guard cp; ((cp anchor) offset) != ((cp focus) offset) #else; false];

// 优先级（后者被前者压制，无需失效命令）：
// 1 按住中的指针会话 → 2 编辑器非塌缩光标 → 3 已定格的指针会话 → 4 编辑器塌缩光标 → 5 程序化
// 状态由调用方读出后一次性传入，保持纯函数
currentPairOf = [op =>
    s = op pointer;
    cp = op active;
    #guard pairPressed $ s;
    pointerPairOf $ s (op list) (op move)
    #guard pairExpanded $ cp;
    cp
    #guard pairFrozen $ s;
    pointerPairOf $ s (op list) (op move)
    #guard hasOf $ cp;
    cp
    #else;
    op programmatic
];

// ---- 区间分配 ----
rangeOfNode = [op =>
    node = op node;
    first = op first;
    second = op second;
    #guard (sameOf $ (first node) node) && (sameOf $ (second node) node);
    {
        sel = node,
        start = (minOf $ (first offset) (second offset)),
        end = (maxOf $ (first offset) (second offset))
    }
    #guard sameOf $ (first node) node;
    { sel = node, start = (first offset), end = (node textLength) }
    #guard sameOf $ (second node) node;
    { sel = node, start = 0, end = (second offset) }
    #guard ((op idx) > (op lo)) && ((op idx) < (op hi));
    { sel = node, start = 0, end = (node textLength) }
    #else;
    nil
];

rangesCoreOf = [pair, list =>
    ia = list indexOf ((pair anchor) node);
    ifo = list indexOf ((pair focus) node);
    #guard (ia >= 0) && (ifo >= 0);
    forward = ia <= ifo;
    first = when $ forward (pair anchor) (pair focus);
    second = when $ forward (pair focus) (pair anchor);
    lo = minOf $ ia ifo;
    hi = maxOf $ ia ifo;
    mapped = list map [node, idx =>
        rangeOfNode $ { node = node, idx = idx, first = first, second = second, lo = lo, hi = hi }
    ];
    // 相邻两条消息必须分行（消息参数之后不能再直接接消息名，否则会被当成新语句）
    mapped filter [r => #guard r; (r end) > (r start) #else; false]
    #else;
    (Array of)
];

unionOf = [a, b =>
    Array of
        (minOf $ (a at 0) (b at 0))
        (minOf $ (a at 1) (b at 1))
        (maxOf $ (a at 2) (b at 2))
        (maxOf $ (a at 3) (b at 3))
];

// 合并包围盒：acc 为空时直接用新矩形（when 急求值，必须走 guard 兜底）
mergeRectOf = [acc, rect => #guard acc; unionOf $ acc rect #else; rect];

// ---- 注册表：节点沿 parent 链找到根节点，再取回自己舞台的协调者 ----
managersRef = storage ref (Array of);
fallbackRef = storage ref nil;

parentOfNode = [node => #guard node; node parent #else; nil];
// 同样用参数自传递做递归（顶层 lambda 拿不到自身绑定）
rootOfNode = [node, self =>
    p = parentOfNode $ node;
    #guard p;
    self $ p self
    #else;
    node
];
managerOfRoot = [root =>
    hit = (managersRef get) find [m => sameOf $ (m root) root];
    #guard hit;
    hit
    #else;
    nil
];

// ---- 工厂：舞台创建时调用一次，返回该舞台专属的消息面 ----
createSelectionManager = [root =>
    pointerRef = storage ref nil;      // { press: hit | nil, release: hit | nil }
    moveRef = storage ref nil;         // 最近一次命中快照
    activePairRef = storage ref nil;   // 聚焦编辑器发布的本地端点对
    programmaticRef = storage ref nil; // select / selectAll 的脉冲
    revSig = createSignal $ 0;
    selfRef = storage ref nil;
    bump = [x => revSig set ((revSig get) + 1)];

    selectablesOf = [x => #guard root; collectOf $ root collectOf #else; (Array of)];
    currentOf = [x =>
        currentPairOf $ {
            pointer = (pointerRef get),
            active = (activePairRef get),
            programmatic = (programmaticRef get),
            list = (selectablesOf $ nil),
            move = (moveRef get)
        }
    ];
    rangesOf = [x =>
        // 读一次版本：让舞台把选区变化接进重绘收集器
        revSig get;
        pair = currentOf $ nil;
        #guard pair;
        rangesCoreOf $ pair (selectablesOf $ nil)
        #else;
        (Array of)
    ];
    rangeOfCore = [sel =>
        hit = (rangesOf $ nil) find [r => sameOf $ (r sel) sel];
        #guard hit;
        Array of (hit start) (hit end)
        #else;
        nil
    ];
    textOf = [x =>
        text = (rangesOf $ nil) reduce [acc, r =>
            acc + ((r sel) textInRange (r start) (r end))
        ] '';
        #guard (text length) > 0;
        text
        #else;
        nil
    ];
    rectOf = [x =>
        (rangesOf $ nil) reduce [acc, r =>
            rect = (r sel) selectionRect;
            #guard rect;
            mergeRectOf $ acc rect
            #else;
            acc
        ] nil
    ];

    mgr = {
        root = root,
        // 读一次即可把选区变化接进重绘收集器
        revision { revSig get },
        pressing { pairPressed $ (pointerRef get) },
        has { hasOf $ (textOf $ nil) },
        rangeOf(sel) { rangeOfCore $ sel },
        text { textOf $ nil },
        rect { rectOf $ nil },
        selectables { selectablesOf $ nil },
        clear {
            programmaticRef set nil;
            pointerRef set nil;
            bump $ nil
        },
        clearPointer { pointerRef set nil; bump $ nil },
        select(sel, a, f) {
            programmaticRef set {
                anchor = { node = sel, offset = a },
                focus = { node = sel, offset = f }
            };
            pointerRef set nil;
            bump $ nil
        },
        selectAll {
            list = selectablesOf $ nil;
            #guard (list length) > 0;
            last = list at ((list length) - 1);
            programmaticRef set {
                anchor = { node = (list at 0), offset = 0 },
                focus = { node = last, offset = (last textLength) }
            };
            pointerRef set nil;
            bump $ nil
        },
        setActive(pair) { activePairRef set pair; bump $ nil },
        down(hit, shift) {
            prev = pointerRef get;
            press = when $ shift (pressOf $ prev) hit;
            pointerRef set { press = press, release = nil };
            moveRef set hit;
            bump $ nil
        },
        move(hit) {
            #guard pairPressed $ (pointerRef get);
            moveRef set hit;
            bump $ nil
        },
        up {
            s = pointerRef get;
            #guard pairPressed $ s;
            hit = moveRef get;
            release = when $ (hasOf $ hit) hit (s press);
            pointerRef set { press = (s press), release = release };
            bump $ nil
        },
        // 舞台销毁：只清自己的引用并摘掉注册，不回写信号（批次监听阶段写信号会撞 didSet 保护）
        reset {
            pointerRef set nil;
            moveRef set nil;
            activePairRef set nil;
            programmaticRef set nil;
            m = selfRef get;
            list = managersRef get;
            managersRef set (list filter [it => (sameOf $ it m) == false])
        }
    };
    selfRef set mgr;
    list = managersRef get;
    managersRef set (list toSpliced (list length) 0 mgr);
    mgr
];

// 兜底协调者：同层多个 #guard 是 else-if，嵌套条件必须拆成独立函数
fallbackManagerOf = [x =>
    cached = fallbackRef get;
    #guard cached;
    cached
    #else;
    fresh = createSelectionManager $ nil;
    fallbackRef set fresh;
    fresh
];
// 孤立节点 / 尚无舞台时也给一个空协调者，调用方不必判空
managerOfNode = [node =>
    hit = managerOfRoot $ (rootOfNode $ node rootOfNode);
    #guard hit;
    hit
    #else;
    fallbackManagerOf $ nil
];
ownerNodeOfSel = [sel => #guard sel; sel ownerNode #else; nil];
managerOfSel = [sel => managerOfNode $ (ownerNodeOfSel $ sel)];

// 兼容入口：节点侧只拿得到自己的能力对象，从 ownerNode 反查所属舞台的协调者
selectionRangeOf = [sel =>
    mgr = managerOfSel $ sel;
    mgr rangeOf sel
];
