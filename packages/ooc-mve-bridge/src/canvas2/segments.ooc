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

// 取某偏移处的风格（落在段内取段风格，否则 nil）。
// 「先命中先赢」：段表万一有重叠（历史数据 / 外部写入），要与 spansOfIn 的单调守卫同口径，
// 不能让后面的段覆盖前面的判定。用独立的命中标志，因为基础样式本身就是 nil。
styleAtIn = [list, index =>
    foundRef = storage ref nil;
    hitRef = storage ref false;
    list forEach [seg, i =>
        #guard ((hitRef get) == false) && ((seg start) <= index) && (index < (seg end));
        foundRef set (seg style);
        hitRef set true
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

// 插入区继承「插入点左邻字符」的样式（文档首没有左邻，退回基础样式）。
// TS 原版：styleAtIn(list, oldText, clamp(p - 1, 0, oldText.length - 1))。
// 取插入点本身是错的：右侧字符可能是另一种样式，打字时会串味。
inheritStyleOf = [list, oldText, p =>
    #guard (oldText length) > 0;
    styleAtIn $ list (maxOf $ 0 (p - 1))
    #else;
    nil
];

// 插入区风格：待输入样式优先，否则继承插入点左邻字符（对齐 TS setStyleRange 之后的打字）
inheritOr = [op, list, oldText, p =>
    #guard op insertStyle;
    op insertStyle
    #else;
    inheritStyleOf $ list oldText p
];

// 文本变化后重排段（对应 alignIn）：公共前后缀不变，变化区间内换成插入点风格。
// 记 p=cutStart、insEnd=新串插入终点、oldRemoveEnd=cutEnd=旧串删除终点、delta=newLen-oldLen：
//   insEnd - oldRemoveEnd == delta，所以右侧碎片整体平移 delta 后正好接在插入区之后。
alignIn = [op =>
    // insertStyle 是可选参数：用 merge 兜底，旧调用方不传也不会读到未定义成员
    safeOp = merge $ op { insertStyle = nil };
    list = op list;
    oldText = op oldText;
    newText = op newText;
    #guard oldText != newText;
    oldLen = oldText length;
    newLen = newText length;
    cutStart = prefixOf $ oldText newText;
    suffix = suffixOf $ oldText newText cutStart;
    cutEnd = oldLen - suffix;
    insEnd = newLen - suffix;
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
        // 跨变化区间：左碎片截到 p；右碎片 [oldRemoveEnd, e) 映射到 [insEnd, ...)，
        // 两端都要加 delta（只加终点会让起点落在插入区里，两段重叠 → 右侧样式整段丢）。
        addIf $ { ref = outRef, start = s, end = (minOf $ e cutStart), style = (seg style) };
        addIf $ { ref = outRef, start = ((maxOf $ s cutEnd) + delta), end = (e + delta), style = (seg style) }
    ];
    addIf $ { ref = outRef, start = cutStart, end = insEnd, style = (inheritOr $ safeOp list oldText cutStart) };
    // 插入区是最后追加的，起点却最靠左：不排序会让 spansOfIn 的单调守卫把它整段跳过，
    // 归一化的「相邻同款」合并也要求按起点有序。与 setRangeIn 同一口径。
    normalizeIn $ ((outRef get) toSorted [x, y => (x start) - (y start)])
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
