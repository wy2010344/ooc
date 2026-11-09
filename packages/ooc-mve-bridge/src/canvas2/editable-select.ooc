// 可编辑节点的「可选文本」能力（对标 canvasRender2 的 Selectable2）。
// 只接收已求值的闭包：p / 选区 ref / 段落 / 节点 ref / 单行滚动推导。
// 坐标为画布全局坐标：选择器据此在跨节点拖拽时换算出各节点内的偏移。

#import {
    storage, merge, absoluteX, absoluteY, paraGlyphAt, paraRects,
    wordRangeOf, paragraphRangeOf
} './host.ts';
#import { selectableDefaults, selectionRangeOf } './selection.ooc';

minOf = [a, b => #guard (a < b); a #else; b];
maxOf = [a, b => #guard (a > b); a #else; b];

// 多行选区合并成一个包围盒
unionRectsOf = [rects =>
    rects reduce [acc, q =>
        #guard acc;
        Array of
            (minOf $ (acc at 0) (q at 0))
            (minOf $ (acc at 1) (q at 1))
            (maxOf $ (acc at 2) (q at 2))
            (maxOf $ (acc at 3) (q at 3))
        #else;
        q
    ] nil
];

makeSelectableOf = [op =>
    selfRef = storage ref nil;
    p = op p;
    selRef = op selRef;
    paraOf = op paraOf;
    nodeRef = op nodeRef;
    scrollXOf = op scrollXOf;
    body = {
        // 反查所属舞台的选区协调者（多舞台并存时不会串到别人的选区）
        ownerNode { nodeRef get },
        // 选中区域包围盒（全局坐标）；无选区 / 无节点时 nil
        selectionRect {
            r = selectionRangeOf $ (selfRef get);
            #guard r;
            node = nodeRef get;
            #guard node;
            rects = paraRects $ (paraOf $) (r at 0) (r at 1);
            #guard (rects length) > 0;
            union = unionRectsOf $ rects;
            ox = (absoluteX $ node) + (node paddingInlineStart);
            oy = (absoluteY $ node) + (node paddingBlockStart);
            Array of (ox + (union at 0)) (oy + (union at 1)) (ox + (union at 2)) (oy + (union at 3))
            #else;
            nil
        },
        textLength { (p text) length },
        // 全局坐标 → 本节点文本偏移
        positionForPoint(gx, gy) {
            node = nodeRef get;
            #guard node;
            para = paraOf $;
            sx = scrollXOf $ node para ((selRef get) at 1);
            x = ((gx - (absoluteX $ node)) - (node paddingInlineStart)) + sx;
            y = (gy - (absoluteY $ node)) - (node paddingBlockStart);
            paraGlyphAt $ para x y
            #else;
            0
        },
        textInRange(start, end) { (p text) slice start end },
        wordRangeAt(offset) { wordRangeOf $ (p text) offset },
        paragraphRangeAt(offset) { paragraphRangeOf $ (p text) offset }
    };
    obj = merge $ body selectableDefaults;
    selfRef set obj;
    obj
];

{ makeSelectableOf = makeSelectableOf, selectableDefaults = selectableDefaults }
