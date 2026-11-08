// 待办行：一行一个组件，状态全部从信号现读（draw / 事件里读，不能在构建期冻结）。
// 文字一律用 text 组件：宽度 / 高度由文字自己回答，行内只负责排列与配色。
#import { rgba, flex2, grow2, colorToCSS } '../bridge.ts';
#import { rect, textNode } '../../../../ooc-mve-bridge/src/canvas2/index.ooc';
#import { paintRound } './canvas2-todo-ui.ooc';
#import {
    rowHeight,
    hoverNow,
    selectedNow,
    selectTodo,
    hoverTodo,
    toggleTodo,
    removeTodo
} './canvas2-todo-store.ooc';

rowBgOf = [op =>
    p = op p;
    t = op t;
    selId = op selId;
    hovId = op hovId;
    #guard ((t id) == selId);
    p accentSoft
    #guard ((t id) == hovId);
    p cardHover
    #guard (t done);
    p cardDone
    #else;
    p card
];

rowBorderOf = [p, t, selId =>
    #guard ((t id) == selId);
    p accent
    #else;
    p border
];

checkBgOf = [p, done => #guard done; p success #else; p card];
checkBorderOf = [p, done => #guard done; p success #else; p borderStrong];
titleColorOf = [p, done => #guard done; p muted #else; p text];
titleDecorationOf = [done => #guard done; 'lineThrough' #else; 'none'];

// 行组件：直接在 each holder（ic）上建节点，父节点即滚动内容
todoRow = [ic, et, getPal =>
    (rect $ {
        height = rowHeight,
        radius = 9,
        paddingInlineStart = 10,
        paddingInlineEnd = 8,
        borderWidth = 1,
        layout = (flex2 $ { direction = 'x', gap = 8, alignItem = 'center', alignFix = true }),
        background { rowBgOf $ { p = (getPal $), t = (et value), selId = (selectedNow $), hovId = (hoverNow $) } },
        borderColor { rowBorderOf $ (getPal $) (et value) (selectedNow $) },
        draw(ctx2, node) {
            #guard ((et value) id) == (selectedNow $);
            paintRound $ { ctx2 = ctx2, x = 0, y = 0, w = 3, h = rowHeight, r = 2, color = ((getPal $) accent) }
        },
        mouseMove(e) { hoverTodo $ ((et value) id) },
        mouseClick(e) { selectTodo $ ((et value) id) }
    }
        // 复选框：命中区域就是 18×18
        (rect $ {
            width = 18,
            height = 18,
            radius = 5,
            borderWidth = 1,
            background { checkBgOf $ (getPal $) ((et value) done) },
            borderColor { checkBorderOf $ (getPal $) ((et value) done) },
            draw(ctx2, node) {
                #guard ((et value) done);
                ctx2 save;
                ctx2 strokeStyle (colorToCSS $ ((getPal $) onAccent));
                ctx2 lineWidth 2;
                ctx2 lineCap 'round';
                ctx2 lineJoin 'round';
                ctx2 beginPath;
                ctx2 moveTo 4 9;
                ctx2 lineTo 7 12;
                ctx2 lineTo 13 5;
                ctx2 stroke;
                ctx2 restore
            },
            mouseClick(e) {
                toggleTodo $ ((et value) id);
                e stopPropagation
            }
        })
        // 标题：grow 占满剩余宽度，单行超出用省略号，完成态加删除线（文字自量尺寸）
        (textNode $ {
            text { (et value) text },
            fontSize = 13,
            fontWeight = 500,
            color { titleColorOf $ (getPal $) ((et value) done) },
            maxLines = 1,
            ellipsis = '…',
            decoration { titleDecorationOf $ ((et value) done) },
            exts = (Array of (grow2 $ { argGrow = 1 }))
        })
        // 标签：固定胶囊，文字在胶囊里居中
        (rect $ {
            width = 46,
            height = 18,
            radius = 9,
            background { (getPal $) tagBg },
            layout = (flex2 $ { direction = 'x', alignItem = 'center', directionJustify = 'center' })
        }
            (textNode $ {
                text { (et value) tag },
                fontSize = 10,
                fontWeight = 600,
                color { (getPal $) tagText },
                autoWidth = true
            })
        )
        // 删除：先吞掉点击，避免顺带选中整行
        (rect $ {
            width = 18,
            height = 18,
            radius = 5,
            draw(ctx2, node) {
                ctx2 save;
                ctx2 strokeStyle (colorToCSS $ ((getPal $) muted));
                ctx2 lineWidth 1.6;
                ctx2 lineCap 'round';
                ctx2 beginPath;
                ctx2 moveTo 5 5;
                ctx2 lineTo 13 13;
                ctx2 moveTo 13 5;
                ctx2 lineTo 5 13;
                ctx2 stroke;
                ctx2 restore
            },
            mouseClick(e) {
                removeTodo $ ((et value) id);
                e stopPropagation
            }
        })
    ) $ ic
];

{ todoRow = todoRow }
