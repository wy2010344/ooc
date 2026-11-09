// 文本节点（对标 canvasRender2 的 WrappedTextNode + RichTextNode 的尺寸 / 绘制语义）。
// 与 TS 唯一的平台差异：段落排版由宿主 text-measure.ts 用 Canvas2D 完成
// （TS 用 CanvasKit Paragraph）。语义一致：尺寸由文字撑开、autoWidth / noWrap /
// maxLines / ellipsis / textAlign / 单行墨迹补偿。
// 组件是 lambda 工厂：`#import { textNode }` 后 `(textNode $ {…}) ctx`。

#import {
    fc, merge, memo, storage, defaultSize, colorToCSS, coreTextDefaults,
    measureTextWidth, measureTextInk, applyTextStyle, wrapText
} './host.ts';
#import { nodeDefaults } './messages.ooc';
#import { buildNode, rendererOf } './node.ooc';

INT_MAX = 2147483647;
// autoWidth / noWrap 用的「无限宽」：wrapText 以 < 1e9 判定软换行，
// 取 1e9 本身才会真正走「只按 '\n' 硬换行」的分支（999999999 仍被当有限宽）。
MAX_WIDTH = 1000000000;
defaultFamily = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

maxZero = [v => #guard (v > 0); v #else; 0];

italicOf = [v => #guard v; 'italic' #else; ''];
familyOf = [f => #guard f; f #else; defaultFamily];
fontOf = [p => '${italicOf $ (p italic)} ${(p fontWeight)} ${(p fontSize)}px ${familyOf $ (p fontFamily)}'];

// 内容盒宽 / 高：与 TS 的 innerSize(node,'x'|'y') 同义
innerXOf = [node => maxZero $ (((node width) - (node paddingInlineStart)) - (node paddingInlineEnd))];
innerYOf = [node => maxZero $ (((node height) - (node paddingBlockStart)) - (node paddingBlockEnd))];

// 内容自测量：fromInside 让 outerSize 再把两端 padding 补上
insideSizeOf = [v => { value = v, fromInside = true }];

// 段落排版宽度：autoWidth / noWrap 不软换行，其余按内容盒宽折行
paraWidthOf = [p, node =>
    #guard ((p autoWidth) || (p noWrap));
    MAX_WIDTH
    #else;
    innerXOf $ node
];

lineHeightOf = [p =>
    m = p lineHeightMultiplier;
    #guard m;
    (p fontSize) * m
    #else;
    p fontSize
];

// 空文本没有段落，退化为 TS 的 maxFontSize * 1.4
textHeightOf = [p, lines =>
    n = lines length;
    #guard (n > 0);
    n * (lineHeightOf $ p)
    #else;
    (p fontSize) * 1.4
];

// ---- 尺寸：x 只在 autoWidth 时由内容推导，y 恒由内容推导（对齐 RichTextNode.size） ----
// 段落只在真正需要时求值（惰性），避免非 autoWidth 的宽度查询把段落卷进布局环。
sizeXOf = [op =>
    p = op p;
    #guard (p autoWidth);
    insideSizeOf $ ((paragraphOf $ p (op ref) (op paraRef)) width)
    #else;
    defaultSize $ (op node) 'x'
];

sizeYOf = [p, ref, paraRef =>
    insideSizeOf $ (textHeightOf $ p ((paragraphOf $ p ref paraRef) lines))
];

// ---- 单行墨迹补偿：只有 autoWidth / noWrap / maxLines == 1 才算单行语义 ----
opticalOf = [p => ((p autoWidth) || (p noWrap) || ((p maxLines) == 1))];

inkShiftCore = [p, lines =>
    #guard ((lines length) > 0);
    font = fontOf $ p;
    ink = measureTextInk $ { font = font, text = (lines at 0), letterSpacing = (p letterSpacing), wordSpacing = (p wordSpacing) };
    ((ink ascent) - (ink descent)) div 2
    #else;
    0
];

inkShiftOf = [p, lines =>
    #guard (opticalOf $ p);
    inkShiftCore $ p lines
    #else;
    0
];

// ---- 对齐 ----
// TS 在无限宽排版下强制 START，再用 noWrapAlignShift 平移绘制原点。
// 这里 wrapText 不带对齐信息（永远按 START 排），平移交给 Canvas2D 的
// textAlign + lineXOf 完成，单行结果与 TS 一致；autoWidth 仍强制 START。
effectiveAlignOf = [p => #guard (p autoWidth); 'start' #else; (p textAlign)];

lineAlignOf = [align =>
    #guard (align == 'center');
    'center'
    #guard (align == 'end');
    'right'
    #else;
    'left'
];

lineXOf = [node, align, inner =>
    start = node paddingInlineStart;
    #guard (align == 'center');
    start + (inner div 2)
    #guard (align == 'end');
    start + inner
    #else;
    start
];

// ---- 装饰线（对齐 RichTextStyle.decoration；绘制在文字之后） ----
decorationLeftOf = [x, w, align =>
    #guard (align == 'center');
    x - (w div 2)
    #guard (align == 'right');
    x - w
    #else;
    x
];

decorationYOf = [kind, y, size =>
    #guard (kind == 'underline');
    y + (size * 0.36)
    #else;
    y + (size * 0.05)
];

paintDecorationCore = [op =>
    w = measureTextWidth $ {
        font = (op font),
        text = (op line),
        letterSpacing = ((op p) letterSpacing),
        wordSpacing = ((op p) wordSpacing)
    };
    #guard (w > 0);
    ctx2 = op ctx2;
    p = op p;
    left = decorationLeftOf $ (op x) w (op align);
    dy = decorationYOf $ (op kind) (op y) (p fontSize);
    ctx2 save;
    ctx2 strokeStyle (colorToCSS $ (p color));
    ctx2 lineWidth 1;
    ctx2 beginPath;
    ctx2 moveTo left dy;
    ctx2 lineTo (left + w) dy;
    ctx2 stroke;
    ctx2 restore
];

paintDecoration = [op =>
    kind = (op p) decoration;
    #guard (kind != 'none');
    paintDecorationCore $ (merge $ op { kind = kind })
];

// ---- 逐行绘制 ----
paintParagraph = [op =>
    ctx2 = op ctx2;
    p = op p;
    node = op node;
    par = op par;
    lines = par lines;
    font = fontOf $ p;
    align = effectiveAlignOf $ p;
    inner = innerXOf $ node;
    x = lineXOf $ node align inner;
    ta = lineAlignOf $ align;
    lh = lineHeightOf $ p;
    y0 = (node paddingBlockStart) + (lh div 2) + (inkShiftOf $ p lines);
    ctx2 save;
    applyTextStyle $ { ctx2 = ctx2, font = font, letterSpacing = (p letterSpacing), wordSpacing = (p wordSpacing) };
    ctx2 fillStyle (colorToCSS $ (p color));
    ctx2 textAlign ta;
    ctx2 textBaseline 'middle';
    lines forEach [line, i =>
        y = y0 + (i * lh);
        ctx2 fillText line x y;
        paintDecoration $ { ctx2 = ctx2, p = p, font = font, line = line, x = x, y = y, align = ta }
    ];
    ctx2 restore
];

// noWrap 且非 autoWidth：溢出裁到内容盒（对齐 TS 的 clip）
drawParagraphOf = [op =>
    ctx2 = op ctx2;
    p = op p;
    node = op node;
    par = op par;
    clip = (p noWrap) && ((p autoWidth) == false);
    #guard clip;
    ctx2 save;
    ctx2 beginPath;
    // 裁内容盒而不是整个节点盒：padding 区不该出现溢出的字形（对齐 RichTextNode.draw 的 clip）
    ctx2 rect (node paddingInlineStart) (node paddingBlockStart) (innerXOf $ node) (innerYOf $ node);
    ctx2 clip;
    paintParagraph $ op;
    ctx2 restore
    #else;
    paintParagraph $ op
];

// 段落缓存：首次需要时建 memo（依赖信号变化后下次调用重算）。
// 不用对象成员的零参方法做自调用（那样只能写 `this paragraph`，语义还不稳）。
paragraphOf = [p, ref, paraRef =>
    cached = paraRef get;
    #guard cached;
    cached $
    #else;
    node = ref get;
    fresh = memo $ [
        value = p text;
        #guard (value length) == 0;
        { lines = (Array of), width = 0 }
        #else;
        wrapText $ {
            font = (fontOf $ p),
            text = value,
            maxWidth = (paraWidthOf $ p node),
            maxLines = (p maxLines),
            ellipsis = (p ellipsis),
            letterSpacing = (p letterSpacing),
            wordSpacing = (p wordSpacing)
        }
    ];
    paraRef set fresh;
    fresh $
];

// ---- 节点自有消息 ----
// x 分支按需才取段落：非 autoWidth 走 defaultSize，不能提前求值段落，
// 否则「段落 -> 宽度 -> 父布局 -> 子高度 -> 段落」会重入 memo。
textOwn = [p, ref, paraRef => {
    size(d, node) {
        #guard (d == 'x');
        sizeXOf $ { p = p, node = node, ref = ref, paraRef = paraRef }
        #else;
        sizeYOf $ p ref paraRef
    },
    draw(ctx2, node) {
        // 用户回调先行（对齐 RichTextNode.draw 里的 p.draw）
        p draw ctx2 node;
        par = paragraphOf $ p ref paraRef;
        #guard ((par lines) length) > 0;
        drawParagraphOf $ { ctx2 = ctx2, p = p, node = node, par = par }
    }
}];

// 参数兜底：纯字面量用 =；跟随信号的由调用方写成方法
textDefaults = {
    text = '',
    fontFamily = nil,
    fontSize = 16,
    fontWeight = 400,
    italic = false,
    // TS 的 WrappedTextNode / editable params 都取 textDefaults.text()：
    // 写成方法而非字面量，主题回写默认色后所有文本节点随信号重画
    color { coreTextDefaults text },
    lineHeightMultiplier = 1.4,
    letterSpacing = 0,
    wordSpacing = 0,
    autoWidth = false,
    noWrap = false,
    maxLines = INT_MAX,
    ellipsis = '…',
    textAlign = 'start',
    decoration = 'none',
    draw(ctx2, node) { nil }
};

// 文本工厂：p = props + 兜底；节点消息 = 自有消息 > p > 基础兜底
textNode = fc $ [ctx, props, ...children =>
    p = merge $ props textDefaults;
    ref = storage ref nil;
    paraRef = storage ref nil;
    nodeProps = merge $ props { nodeRef = ref };
    node = buildNode $ {
        ctx = ctx,
        parent = (ctx getParent),
        strategy = (merge $ (textOwn $ p ref paraRef) p nodeDefaults),
        props = nodeProps,
        children = children,
        renderer = (rendererOf $ ctx)
    };
    ctx addNode node;
    node
];

{ textNode = textNode, textDefaults = textDefaults }
