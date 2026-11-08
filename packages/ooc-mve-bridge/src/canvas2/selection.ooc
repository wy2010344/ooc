// 全局选区协调者（对标 canvasRender2/selection/manager.ts 与 selectable.ts）。
// 单一真相：指针会话 / 编辑器本地光标 / 程序化指令三路按优先级派生，
// 节点只按 rangeOf 读取自己那一份区间来画高亮，没有任何反向写回。
//
// 节点报名方式：实现一条 `selectable` 消息返回能力对象（缺省在 messages.ooc 里给 nil），
// 能力对象 merge $ 自己的实现 selectableDefaults。

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

// ---- 全局状态（单例；舞台创建时登记根节点） ----
rootRef = storage ref nil;
pointerRef = storage ref nil;      // { press: hit | nil, release: hit | nil }
moveRef = storage ref nil;         // 最近一次命中快照
activePairRef = storage ref nil;   // 聚焦编辑器发布的本地端点对
programmaticRef = storage ref nil; // select / selectAll 的脉冲
revSig = createSignal $ 0;
bump = [x => revSig set ((revSig get) + 1)];

// 两条消息都答得出来：没有分词 / 分段能力的实现 merge 它即可
selectableDefaults = {
    wordRangeAt(offset) { nil },
    paragraphRangeAt(offset) { nil }
};

// ---- 可选集合：文档序前序遍历；selectionEnabled 为 false 剪掉整棵子树 ----
collectOf = [node =>
    (node children) reduce [acc, child =>
        #guard child selectionEnabled;
        sel = child selectable;
        base = when $ (hasOf $ sel) (acc toSpliced (acc length) 0 sel) acc;
        base concat (collectOf $ child)
        #else;
        acc
    ] (Array of)
];

selectablesOf = [x =>
    root = rootRef get;
    #guard root;
    collectOf $ root
    #else;
    (Array of)
];

// ---- 命中快照 → 端点（链从深到浅找第一个在册可选节点） ----
nodeOfHit = [hit =>
    list = selectablesOf $ nil;
    chain = hit chain;
    (chain toReversed) find [n => (list indexOf (n selectable)) >= 0]
];

pointCoreOf = [hit =>
    node = nodeOfHit $ hit;
    #guard node;
    sel = node selectable;
    {
        node = sel,
        offset = clampTo $ (sel positionForPoint (hit x) (hit y)) 0 (sel textLength)
    }
    #else;
    nil
];

pointOf = [hit =>
    #guard hit;
    pointCoreOf $ hit
    #else;
    nil
];

pointerPairOf = [s =>
    a = pointOf $ (s press);
    #guard a;
    b = when $ (hasOf $ (s release)) (pointOf $ (s release)) (pointOf $ (moveRef get));
    { anchor = a, focus = (when $ (hasOf $ b) b a) }
];

pairPressed = [s => #guard s; isNilOf $ (s release) #else; false];
pairFrozen = [s => #guard s; hasOf $ (s release) #else; false];
pairExpanded = [cp => #guard cp; ((cp anchor) offset) != ((cp focus) offset) #else; false];

// 优先级（后者被前者压制，无需失效命令）：
// 1 按住中的指针会话 → 2 编辑器非塌缩光标 → 3 已定格的指针会话 → 4 编辑器塌缩光标 → 5 程序化
currentPairOf = [x =>
    s = pointerRef get;
    cp = activePairRef get;
    #guard pairPressed $ s;
    pointerPairOf $ s
    #guard pairExpanded $ cp;
    cp
    #guard pairFrozen $ s;
    pointerPairOf $ s
    #guard hasOf $ cp;
    cp
    #else;
    programmaticRef get
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

rangesCoreOf = [pair =>
    list = selectablesOf $ nil;
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

rangesOf = [x =>
    // 读一次版本：让舞台把选区变化接进重绘收集器
    revSig get;
    pair = currentPairOf $ nil;
    #guard pair;
    rangesCoreOf $ pair
    #else;
    (Array of)
];

selectionRangeOf = [sel =>
    hit = (rangesOf $ nil) find [r => sameOf $ (r sel) sel];
    #guard hit;
    Array of (hit start) (hit end)
    #else;
    nil
];

selectionText = [x =>
    text = (rangesOf $ nil) reduce [acc, r =>
        acc + ((r sel) textInRange (r start) (r end))
    ] '';
    #guard (text length) > 0;
    text
    #else;
    nil
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

selectionRect = [x =>
    (rangesOf $ nil) reduce [acc, r =>
        rect = (r sel) selectionRect;
        #guard rect;
        mergeRectOf $ acc rect
        #else;
        acc
    ] nil
];

// ---- 程序化指令 ----
selectionClear = [x =>
    programmaticRef set nil;
    pointerRef set nil;
    bump $ nil
];

selectionClearPointer = [x => pointerRef set nil; bump $ nil];

selectionSelect = [sel, a, f =>
    programmaticRef set {
        anchor = { node = sel, offset = a },
        focus = { node = sel, offset = f }
    };
    pointerRef set nil;
    bump $ nil
];

selectionSelectAll = [x =>
    list = selectablesOf $ nil;
    #guard (list length) > 0;
    last = list at ((list length) - 1);
    programmaticRef set {
        anchor = { node = (list at 0), offset = 0 },
        focus = { node = last, offset = (last textLength) }
    };
    pointerRef set nil;
    bump $ nil
];

// ---- 指针会话入口（舞台转发真实事件；坐标为画布全局坐标） ----
// 只登记根节点，不写信号：新建舞台本身就会首帧重画
setSelectionRoot = [root => rootRef set root];

// 取上一次按下的命中点；没有就返回 nil（when 是急求值，必须走 guard 兜底）
pressOf = [prev => #guard prev; prev press #else; nil];

selectionDown = [hit, shift =>
    prev = pointerRef get;
    press = when $ shift (pressOf $ prev) hit;
    pointerRef set { press = press, release = nil };
    moveRef set hit;
    bump $ nil
];

selectionMove = [hit =>
    #guard pairPressed $ (pointerRef get);
    moveRef set hit;
    bump $ nil
];

selectionUp = [x =>
    s = pointerRef get;
    #guard pairPressed $ s;
    hit = moveRef get;
    release = when $ (hasOf $ hit) hit (s press);
    pointerRef set { press = (s press), release = release };
    bump $ nil
];

selectionSetActive = [pair => activePairRef set pair; bump $ nil];

// 舞台销毁：只清引用不回写信号（批次监听阶段写信号会撞 didSet 保护）
selectionReset = [x =>
    rootRef set nil;
    pointerRef set nil;
    moveRef set nil;
    activePairRef set nil;
    programmaticRef set nil
];

// 是否有正在按住（拖选）的指针会话
selectionPressing = [x => pairPressed $ (pointerRef get)];
// 当前是否存在非空选区文本
selectionHas = [x => hasOf $ (selectionText $ nil)];
// 选区版本号：读一次即可把选区变化接进重绘收集器
selectionRevision = [x => revSig get];

