// 富文本样式段（对标 canvasRender2/editable/richSegments.ts 的纯函数子集）。
// 段 = { start, end, style }，偏移都是「逻辑文本」的；null 风格表示基础样式。
// 全部是纯函数：输入旧段 + 旧/新文本，输出新段。

#import { storage, merge } './host.ts';
#import { when } './when.ooc';

styleDefaults = {
    bold = false,
    italic = false,
    underline = false,
    lineThrough = false,
    color = nil
};

minOf = [a, b => #guard (a < b); a #else; b];
maxOf = [a, b => #guard (a > b); a #else; b];

// 段样式可能只写了部分字段：一律补齐默认值，供后续按消息读取
// merge 是「先命中先赢」：段自己的字段在前，默认值兜底在后
styleOf = [v => #guard v; merge $ v styleDefaults #else; styleDefaults];

sameStyle = [a, b =>
    sa = styleOf $ a;
    sb = styleOf $ b;
    ((sa bold) == (sb bold)) && ((sa italic) == (sb italic)) &&
    ((sa underline) == (sb underline)) && ((sa lineThrough) == (sb lineThrough)) &&
    ((sa color) == (sb color))
];

// 区间重合才算「有内容」；空区间不产生段
addIf = [op =>
    #guard ((op end) > (op start));
    list = (op ref) get;
    (op ref) set (list toSpliced (list length) 0 { start = (op start), end = (op end), style = (op style) })
];

lastEndOf = [last => #guard last; last end #else; 0 - 1];
// 取末项：空表返回 nil（不能写成 `x = #guard …`，赋值右侧不允许 guard）
lastOf = [out, n => #guard (n > 0); out at (n - 1) #else; nil];
sameStyleOf = [last, seg =>
    #guard last;
    sameStyle $ (last style) (seg style)
    #else;
    false
];

// 追加一段：零长度直接忽略
appendSegIn = [outRef, start, end, style =>
    #guard (end > start);
    out = outRef get;
    outRef set (out toSpliced (out length) 0 { start = start, end = end, style = style })
];

// 合并相邻同款风格；零长度段丢弃
normalizeIn = [list =>
    outRef = storage ref (Array of);
    list forEach [seg, i =>
        start = seg start;
        end = seg end;
        out = outRef get;
        n = out length;
        last = lastOf $ out n;
        merged = sameStyleOf $ last seg;
        // 多个 #guard 是 if / else-if（命中即返回），条件必须一次算完再进分支
        #guard (end > start) && merged && ((lastEndOf $ last) == start);
        outRef set (out toSpliced (n - 1) 1 { start = (last start), end = end, style = (last style) })
        #else;
        appendSegIn $ outRef start end (seg style)
    ];
    outRef get
];

// 取某偏移处的风格（落在段内取段风格，否则 nil）
styleAtIn = [list, index =>
    foundRef = storage ref nil;
    list forEach [seg, i =>
        #guard ((seg start) <= index) && (index < (seg end));
        foundRef set (seg style)
    ];
    foundRef get
];

// 把 [a, b) 刷成同一风格（对应 setRangeIn）。
// 区间外原样保留（被切口的两侧各留碎片），区间内整段用 style——
// 这样「无段」的文本（基础风格）也能被刷上样式。
setRangeIn = [op =>
    list = op list;
    a = op start;
    b = op end;
    len = op length;
    style = op style;
    outRef = storage ref (Array of);
    list forEach [seg, i =>
        s = seg start;
        e = seg end;
        #guard (e > s);
        addIf $ { ref = outRef, start = s, end = (minOf $ e a), style = (seg style) };
        addIf $ { ref = outRef, start = (maxOf $ s b), end = e, style = (seg style) }
    ];
    addIf $ { ref = outRef, start = a, end = (minOf $ b len), style = style };
    // 碎片是乱序追加的，先按起点排序再归一
    normalizeIn $ ((outRef get) toSorted [x, y => (x start) - (y start)])
];

// 公共前缀长度
prefixOf = [a, b =>
    lim = minOf $ (a length) (b length);
    ca = a split '';
    cb = b split '';
    pos = ca findIndex [ch, i => (i < lim) && (ch != (cb at i))];
    #guard (pos >= 0);
    pos
    #else;
    lim
];

// 公共后缀长度（不与前缀重叠）
suffixOf = [a, b, prefix =>
    maxS = (minOf $ (a length) (b length)) - prefix;
    ra = (a split '') reverse;
    rb = (b split '') reverse;
    pos = ra findIndex [ch, i => (i < maxS) && (ch != (rb at i))];
    #guard (pos >= 0);
    pos
    #else;
    maxS
];

// 文本变化后重排段（对应 alignIn）：公共前后缀不变，变化区间内换成插入点风格。
alignIn = [op =>
    list = op list;
    oldText = op oldText;
    newText = op newText;
    #guard oldText != newText;
    oldLen = oldText length;
    newLen = newText length;
    cutStart = prefixOf $ oldText newText;
    suffix = suffixOf $ oldText newText cutStart;
    cutEnd = oldLen - suffix;
    delta = newLen - oldLen;
    outRef = storage ref (Array of);
    list forEach [seg, i =>
        s = seg start;
        e = seg end;
        // 完全在变化区间之外；切点右侧整体平移
        outside = (e <= cutStart) || (s >= cutEnd);
        shifted = s >= cutEnd;
        start2 = when $ shifted (s + delta) s;
        end2 = when $ shifted (e + delta) e;
        // 条件一次算完（多个 #guard 是 else-if，命中即返回）
        #guard (e > s) && outside;
        addIf $ { ref = outRef, start = start2, end = end2, style = (seg style) }
        #else;
        // 跨变化区间：保留左侧与右侧碎片
        addIf $ { ref = outRef, start = s, end = (minOf $ e cutStart), style = (seg style) };
        addIf $ { ref = outRef, start = (maxOf $ s cutEnd), end = (e - (oldLen - newLen)), style = (seg style) }
    ];
    // 变化区间替换成一段：风格取自插入点
    addIf $ { ref = outRef, start = cutStart, end = (cutStart + (newLen - cutStart - suffix)), style = (styleAtIn $ list cutStart) };
    normalizeIn $ (outRef get)
];

{
    styleDefaults = styleDefaults,
    styleOf = styleOf,
    sameStyle = sameStyle,
    normalizeIn = normalizeIn,
    styleAtIn = styleAtIn,
    setRangeIn = setRangeIn,
    alignIn = alignIn
}
