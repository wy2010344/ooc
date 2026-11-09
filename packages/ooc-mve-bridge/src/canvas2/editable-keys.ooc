// 富文本编辑的键位与文本变更（对标 canvasRender2/editable/editor.ts 的 KeyCommand 子集）。
// 不直接持有任何节点：env 提供 p / 选区 ref / 段落 / 回写函数，纯逻辑在此展开。

#import {
    paraCaretRect, paraLineIndexOf, paraOffsetOnLine, paraLineEdge, paraLineCount,
    wordRangeOf
} './host.ts';
#import { when } './when.ooc';

minOf = [a, b => #guard (a < b); a #else; b];
maxOf = [a, b => #guard (a > b); a #else; b];
clampIn = [v, a, b => minOf $ b (maxOf $ a v)];
prefOr = [pref, fallback => #guard pref != nil; pref #else; fallback];

caretLeftOf = [para, index => r = paraCaretRect $ para index; #guard r; r at 0 #else; 0];

caretMidYOf = [para, index => r = paraCaretRect $ para index; #guard r; ((r at 1) + (r at 3)) div 2 #else; 0];

prevIndexOf = [text, pos => #guard (pos > 0); pos - 1 #else; 0];
nextIndexOf = [text, pos => #guard (pos < (text length)); pos + 1 #else; pos];

// 词边界：拿不到就退化成单字符（删空白 / 标点时至少前进一格）
wordRangeAtIn = [text, pos =>
    r = wordRangeOf $ text pos;
    #guard r;
    r
    #else;
    Array of pos pos
];

wordLeftPosIn = [text, pos =>
    #guard (pos > 0);
    (wordRangeAtIn $ text (pos - 1)) at 0
    #else;
    0
];

wordRightPosIn = [text, pos =>
    #guard (pos < (text length));
    (wordRangeAtIn $ text pos) at 1
    #else;
    text length
];

selectionIn = [env =>
    sel = (env selRef) get;
    {
        a = (sel at 0),
        f = (sel at 1),
        lo = (minOf $ (sel at 0) (sel at 1)),
        hi = (maxOf $ (sel at 0) (sel at 1))
    }
];

// 用区间替换文本：pushUndo → 回写 → 光标记到替换末尾
replaceRangeIn = [op =>
    env = op env;
    oldText = (env p) text;
    next = (oldText slice 0 (op start)) + (op value) + (oldText slice (op end) (oldText length));
    env pushUndo $;
    env updateText $ next;
    env setSel $ ((op start) + ((op value) length)) ((op start) + ((op value) length))
];

// 空区间自动跳过：不产生无意义的撤销记录
deleteRangeIn = [env, start, end =>
    #guard (end > start);
    replaceRangeIn $ { env = env, start = start, end = end, value = '' }
];

// 扩展选区：shift 保留锚点，否则折叠到 f
selectIn = [op =>
    #guard (op shift);
    (op env) setSel $ (op a) (op f)
    #else;
    (op env) setSel $ (op f) (op f)
];

keyBackspaceIn = [env =>
    sel = selectionIn $ env;
    prev = prevIndexOf $ ((env p) text) (sel lo);
    start = when $ ((sel lo) != (sel hi)) (sel lo) prev;
    end = when $ ((sel lo) != (sel hi)) (sel hi) (sel lo);
    deleteRangeIn $ env start end
];

keyDeleteIn = [env =>
    sel = selectionIn $ env;
    oldText = (env p) text;
    next = nextIndexOf $ oldText (sel hi);
    start = when $ ((sel lo) != (sel hi)) (sel lo) (sel hi);
    end = when $ ((sel lo) != (sel hi)) (sel hi) next;
    deleteRangeIn $ env start end
];

keyWordBackspaceIn = [env =>
    sel = selectionIn $ env;
    #guard ((sel lo) != (sel hi));
    deleteRangeIn $ env (sel lo) (sel hi)
    #else;
    keyWordBackspaceCore $ env (sel lo)
];

keyWordBackspaceCore = [env, pos =>
    old = (env p) text;
    w = wordRangeAtIn $ old (prevIndexOf $ old pos);
    deleteRangeIn $ env (w at 0) pos
];

keyWordDeleteIn = [env =>
    sel = selectionIn $ env;
    #guard ((sel lo) != (sel hi));
    deleteRangeIn $ env (sel lo) (sel hi)
    #else;
    keyWordDeleteCore $ env (sel hi)
];

keyWordDeleteCore = [env, pos =>
    old = (env p) text;
    #guard pos < (old length);
    w = wordRangeAtIn $ old pos;
    deleteRangeIn $ env pos (maxOf $ (w at 1) (nextIndexOf $ old pos))
];

keyWordMoveIn = [env, shift, forward =>
    sel = selectionIn $ env;
    old = (env p) text;
    cur = when $ forward (sel hi) (sel lo);
    pos = when $ forward (wordRightPosIn $ old cur) (wordLeftPosIn $ old cur);
    (env preferredXRef) set nil;
    selectIn $ { env = env, a = (sel a), f = pos, shift = shift }
];

keyLeftIn = [env, shift =>
    sel = selectionIn $ env;
    oldText = (env p) text;
    pos = when $ shift (prevIndexOf $ oldText (sel f)) (prevIndexOf $ oldText (sel lo));
    (env preferredXRef) set nil;
    selectIn $ { env = env, a = (sel a), f = pos, shift = shift }
];

keyRightIn = [env, shift =>
    sel = selectionIn $ env;
    oldText = (env p) text;
    pos = when $ shift (nextIndexOf $ oldText (sel f)) (nextIndexOf $ oldText (sel hi));
    (env preferredXRef) set nil;
    selectIn $ { env = env, a = (sel a), f = pos, shift = shift }
];

// 上下移动：保持视觉列；落到目标软行
moveVerticalIn = [env, shift, dir =>
    para = env paraOf $;
    sel = selectionIn $ env;
    f = sel f;
    x = prefOr $ ((env preferredXRef) get) (caretLeftOf $ para f);
    line = paraLineIndexOf $ para (caretMidYOf $ para f);
    target = clampIn $ (line + dir) 0 ((paraLineCount $ para) - 1);
    pos = paraOffsetOnLine $ para target x;
    #guard pos != nil;
    (env preferredXRef) set x;
    selectIn $ { env = env, a = (sel a), f = pos, shift = shift }
];

keyHomeIn = [env, mod, shift =>
    par = env paraOf $;
    sel = selectionIn $ env;
    edge = paraLineEdge $ par (paraLineIndexOf $ par (caretMidYOf $ par (sel f)));
    pos = when $ mod 0 (edge start);
    selectIn $ { env = env, a = (sel a), f = pos, shift = shift }
];

keyEndIn = [env, mod, shift =>
    par = env paraOf $;
    sel = selectionIn $ env;
    edge = paraLineEdge $ par (paraLineIndexOf $ par (caretMidYOf $ par (sel f)));
    pos = when $ mod (((env p) text) length) (edge end);
    selectIn $ { env = env, a = (sel a), f = pos, shift = shift }
];

keyEnterIn = [env =>
    p = env p;
    #guard (p singleLine);
    p onSubmit;
    nil
    #else;
    sel = selectionIn $ env;
    replaceRangeIn $ { env = env, start = (sel lo), end = (sel hi), value = '\n' }
];

keyInsertIn = [env, raw =>
    sel = selectionIn $ env;
    replaceRangeIn $ { env = env, start = (sel lo), end = (sel hi), value = raw }
];

// 键位主入口：返回 true 表示已消费（宿主会 preventDefault）
handleKeyIn = [env, e =>
    p = env p;
    text = p text;
    raw = e key;
    k = raw toLowerCase;
    mod = (e ctrl) || (e meta);
    shift = e shift;
    alt = e alt;

    #guard mod && (k == 'a');
    env setSel $ 0 (text length);
    true

    #guard mod && (k == 'z') && (shift == false);
    env undo $;
    true

    #guard mod && ((k == 'y') || ((k == 'z') && shift));
    env redo $;
    true

    // Ctrl/Cmd + B / I / U：与工具栏同一条样式开关（env 里注入，避免与 editable-style 循环依赖）
    #guard mod && (k == 'b');
    (env toggleStyle) $ [st => st bold] [on => { bold = on }];
    true

    #guard mod && (k == 'i');
    (env toggleStyle) $ [st => st italic] [on => { italic = on }];
    true

    #guard mod && (k == 'u');
    (env toggleStyle) $ [st => st underline] [on => { underline = on }];
    true

    // Ctrl/Cmd 组合的词级操作要排在普通键前面
    #guard mod && (k == 'backspace');
    keyWordBackspaceIn $ env;
    true

    #guard mod && (k == 'delete');
    keyWordDeleteIn $ env;
    true

    #guard mod && (k == 'arrowleft');
    keyWordMoveIn $ env shift false;
    true

    #guard mod && (k == 'arrowright');
    keyWordMoveIn $ env shift true;
    true

    #guard k == 'backspace';
    keyBackspaceIn $ env;
    true

    #guard k == 'delete';
    keyDeleteIn $ env;
    true

    #guard k == 'arrowleft';
    keyLeftIn $ env shift;
    true

    #guard k == 'arrowright';
    keyRightIn $ env shift;
    true

    #guard k == 'arrowup';
    moveVerticalIn $ env shift (0 - 1);
    true

    #guard k == 'arrowdown';
    moveVerticalIn $ env shift 1;
    true

    #guard k == 'home';
    keyHomeIn $ env mod shift;
    true

    #guard k == 'end';
    keyEndIn $ env mod shift;
    true

    #guard k == 'enter';
    keyEnterIn $ env;
    true

    // 可打印字符（含空格）；Ctrl/Meta/Alt 组合交给浏览器
    #guard ((raw length) == 1) && (mod == false) && (alt == false);
    keyInsertIn $ env raw;
    true

    #else;
    false
];

{
    handleKeyIn = handleKeyIn,
    replaceRangeIn = replaceRangeIn,
    selectionIn = selectionIn,
    keyInsertIn = keyInsertIn
}
