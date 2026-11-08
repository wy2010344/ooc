// 可编辑富文本节点（对标 canvasRender2/EditableTextNode.ts 的显示部分）。
// 纯排版与绘制：状态、键位、鼠标都在 editable.ooc 里；这里只接收「已求值的数据」。
// 段落对象来自宿主 rich-paragraph.ts（buildRichParagraph），坐标为节点内容盒原点。

#import {
    colorToCSS, applyTextStyle, paraRects, paraCaretRect, drawRichParagraph
} './host.ts';
#import { fontOf } './text-style.ooc';
#import { styleDefaults } './segments.ooc';

maxZero = [v => #guard (v > 0); v #else; 0];

editorDefaults = {
    // ---- 数据来源 / 回写 ----
    text = '',
    segments { (Array of) },
    onTextChange(t) { nil },
    onSegmentsChange(list) { nil },
    onSubmit = nil,
    // 句柄出口：构建完成时回调（外部存起来即可按消息调用）
    setHandle(h) { nil },
    // ---- 排版 ----
    fontSize = 16,
    fontWeight = 400,
    italic = false,
    fontFamily = nil,
    color = 4278190080,
    selectionColor = 1430950114,
    caretColor = nil,
    lineHeightMultiplier = 1.4,
    letterSpacing = 0,
    wordSpacing = 0,
    singleLine = false,
    readOnly = false,
    placeholder = '',
    placeholderColor = 2290649224,
    // ---- 自定义绘制（在文字之后） ----
    draw(ctx2, node) { nil }
};

lineHeightOf = [p => (p fontSize) * (p lineHeightMultiplier)];
innerWidthOf = [node =>
    maxZero $ (((node width) - (node paddingInlineStart)) - (node paddingInlineEnd))
];

caretLeftOf = [para, index =>
    r = paraCaretRect $ para index;
    #guard r;
    r at 0
    #else;
    0
];

// 光标矩形（段落坐标）；末位空矩形补 2px 宽便于填充
drawCaret = [op =>
    r = paraCaretRect $ (op para) (op index);
    #guard r;
    left = (op padX) + ((r at 0) - (op scrollX));
    top = (op padY) + (r at 1);
    top2 = (op padY) + (r at 3);
    ctx2 = op ctx2;
    ctx2 fillStyle (colorToCSS $ (op color));
    ctx2 fillRect left top 2 (maxZero $ (top2 - top))
];

drawPlaceholder = [op =>
    p = op p;
    #guard ((p placeholder) length) > 0;
    ctx2 = op ctx2;
    font = fontOf $ p styleDefaults;
    ctx2 save;
    applyTextStyle $ { ctx2 = ctx2, font = font, letterSpacing = (p letterSpacing), wordSpacing = (p wordSpacing) };
    ctx2 globalAlpha 0.45;
    ctx2 fillStyle (colorToCSS $ (p placeholderColor));
    ctx2 textAlign 'left';
    ctx2 textBaseline 'middle';
    ctx2 fillText (p placeholder) (op padX) ((op padY) + ((lineHeightOf $ p) div 2));
    ctx2 restore
];

// ctx2 / p / node / para / scrollX / 选区 / 焦点状态全部由调用方求值
drawEditorIn = [op =>
    p = op p;
    node = op node;
    #guard (p singleLine);
    ctx2 = op ctx2;
    ctx2 save;
    ctx2 beginPath;
    ctx2 rect 0 0 (node width) (node height);
    ctx2 clip;
    paintEditorBody $ op;
    ctx2 restore
    #else;
    paintEditorBody $ op
];

drawCaretMaybe = [op =>
    #guard (op focused) && (op blink);
    drawCaret $ op
];

paintSelection = [op =>
    p = op p;
    lo = op selStart;
    hi = op selEnd;
    ctx2 = op ctx2;
    padX = (op padX);
    padY = (op padY);
    rects = paraRects $ (op para) lo hi;
    #guard hi > lo;
    ctx2 save;
    ctx2 fillStyle (colorToCSS $ (p selectionColor));
    rects forEach [r, i =>
        ctx2 fillRect ((padX + (r at 0))) (padY + (r at 1)) ((r at 2) - (r at 0)) ((r at 3) - (r at 1))
    ];
    ctx2 restore
];

// 占位符 / 光标二选一：空文本画占位符，否则按焦点画光标
paintCaretPart = [op =>
    #guard (((op p) text) length) == 0;
    drawPlaceholder $ { ctx2 = (op ctx2), p = (op p), padX = (op padX), padY = (op padY) }
    #else;
    drawCaretMaybe $ {
        ctx2 = (op ctx2),
        para = (op para),
        index = (op caretIndex),
        padX = (op padX),
        padY = (op padY),
        scrollX = (op scrollX),
        color = (caretColorOf $ (op p)),
        focused = (op focused),
        blink = (op blink)
    }
];

paintEditorBody = [op =>
    p = op p;
    node = op node;
    para = op para;
    ctx2 = op ctx2;
    padX = (node paddingInlineStart) - (op scrollX);
    padY = node paddingBlockStart;
    paintSelection $ {
        ctx2 = ctx2,
        p = p,
        para = para,
        padX = padX,
        padY = padY,
        selStart = (op selStart),
        selEnd = (op selEnd)
    };
    // 正文
    drawRichParagraph $ { p = para, ctx2 = ctx2, ox = padX, oy = padY };
    // 占位符 / 光标
    paintCaretPart $ {
        ctx2 = ctx2,
        p = p,
        para = para,
        padX = padX,
        padY = padY,
        caretIndex = (op caretIndex),
        scrollX = (op scrollX),
        focused = (op focused),
        blink = (op blink)
    };
    p draw ctx2 node
];


caretColorOf = [p => #guard (p caretColor) != nil; (p caretColor) #else; (p color)];

{
    editorDefaults = editorDefaults,
    lineHeightOf = lineHeightOf,
    innerWidthOf = innerWidthOf,
    caretLeftOf = caretLeftOf,
    drawEditorIn = drawEditorIn
}
