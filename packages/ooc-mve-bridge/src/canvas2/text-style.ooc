// 富文本「样式 → 排版片段」：把 segments 切成 host 认识的 span 列表。
// span 字段：text / font / fontSize / color / lineHeight / underline / lineThrough /
// letterSpacing / wordSpacing —— 与 rich-paragraph.ts 的 RichSpanInput 一一对应。

#import { storage } './host.ts';
#import { styleOf } './segments.ooc';

defaultFamily = 'ui-sans-serif, system-ui, -apple-system, sans-serif';
minOf = [a, b => #guard (a < b); a #else; b];
maxOf = [a, b => #guard (a > b); a #else; b];

familyOf = [v => #guard v; v #else; defaultFamily];
italicOf = [p, s => (p italic) || (s italic)];
weightOf = [p, s => #guard (s bold); 700 #else; (p fontWeight)];
colorOf = [p, s => #guard (s color) != nil; (s color) #else; (p color)];

// 斜体前缀：guard 不能写在赋值右侧，抽成小 lambda
italicPartOf = [p, s => #guard (italicOf $ p s); 'italic ' #else; ''];

fontOf = [p, s =>
    it = italicPartOf $ p s;
    '${it}${(weightOf $ p s)} ${(p fontSize)}px ${(familyOf $ (p fontFamily))}'
];

spanOf = [op =>
    p = op p;
    s = styleOf $ (op style);
    {
        // 区间文本：span 只带自己那一段（漏了 slice 会让每个 span 都画整段文本）
        text = ((op text) slice (op start) (op end)),
        font = (fontOf $ p s),
        fontSize = (p fontSize),
        color = (colorOf $ p s),
        lineHeight = ((p fontSize) * (p lineHeightMultiplier)),
        underline = (s underline),
        lineThrough = (s lineThrough),
        letterSpacing = (p letterSpacing),
        wordSpacing = (p wordSpacing)
    }
];

appendSpan = [op =>
    #guard ((op end) > (op start));
    list = (op out) get;
    (op out) set (list toSpliced (list length) 0 (spanOf $ op))
];

orEmpty = [v => #guard v; v #else; (Array of)];

// segments → spans：段之间的空隙用基础样式补齐，越界偏移一律夹到文本长度
spansOfIn = [op =>
    text = op text;
    p = op p;
    segments = orEmpty $ (op segments);
    len = text length;
    outRef = storage ref (Array of);
    posRef = storage ref 0;
    segments forEach [seg, i =>
        s = maxOf $ 0 (minOf $ (seg start) len);
        e = maxOf $ 0 (minOf $ (seg end) len);
        #guard (e > (posRef get)) && (s >= (posRef get));
        appendSpan $ { out = outRef, text = text, start = (posRef get), end = s, style = nil, p = p };
        appendSpan $ { out = outRef, text = text, start = s, end = e, style = (seg style), p = p };
        posRef set e
    ];
    appendSpan $ { out = outRef, text = text, start = (posRef get), end = len, style = nil, p = p };
    outRef get
];

{
    fontOf = fontOf,
    spansOfIn = spansOfIn
}
