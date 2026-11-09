// 编辑器的样式变更 + IME 组合输入（从 editable.ooc 拆出，保持单文件 ≤300 行）。
// 所有函数都接收共享 env（p / segRef / composingBaseRef / 选区与历史操作）。

#import { merge, storage, syncInputPosition } './host.ts';
#import { styleOf, styleAtIn, setRangeIn } './segments.ooc';
#import { selectionIn } './editable-keys.ooc';

minOf = [a, b => #guard (a < b); a #else; b];
maxOf = [a, b => #guard (a > b); a #else; b];

// 区间内每个样式段是否都命中某个标志：全覆盖且全部为真才算「已启用」
// 读字段用调用方给的 read lambda（原生 propOf 读 merge 代理只会拿到转发函数）
allFlagIn = [op =>
    okRef = storage ref true;
    coveredRef = storage ref 0;
    len = (op end) - (op start);
    (op list) forEach [seg, i =>
        os = maxOf $ (seg start) (op start);
        oe = minOf $ (seg end) (op end);
        #guard (oe > os);
        coveredRef set ((coveredRef get) + (oe - os));
        okRef set ((okRef get) && ((op read) $ (styleOf $ (seg style))))
    ];
    (okRef get) && ((coveredRef get) >= len)
];

// 把 [a, b) 刷成 base + patch
applyPatchIn = [env, a, b, patch =>
    list = (env segRef) get;
    #guard (b > a);
    base = styleOf $ (styleAtIn $ list a);
    // patch 在前：新开关覆盖旧值，其余字段沿用 base
    merged = merge $ patch base;
    next = setRangeIn $ {
        list = list,
        start = a,
        end = b,
        length = ((env p) text) length,
        style = merged
    };
    // 样式变更也进撤销栈（与打字同一条历史）
    (env pushUndo) $;
    (env segRef) set next;
    // 刷完选区，后续接着输入沿用刚设的样式
    (env pendingRef) set merged;
    // 样式段不是信号：显式通知排版失效并重绘画布
    (env touchSegs) $;
    (env bump) $;
    (env p) onSegmentsChange next;
    syncInputPosition $
];

// 待输入样式里某个标志当前是否打开（nil 视作全关）
pendingFlagOf = [style, read =>
    #guard style;
    (read $ (styleOf $ style)) == true
    #else;
    false
];

// 光标塌缩：没有区间可刷，改待输入样式，下一次输入由 alignIn 的 insertStyle 落到插入区
togglePendingIn = [env, read, patch =>
    cur = (env pendingRef) get;
    on = pendingFlagOf $ cur read;
    next = merge $ (patch $ (on == false)) (styleOf $ cur);
    (env pendingRef) set next;
    (env bump) $
];

// 工具栏开关：整段已启用就关掉，否则打开；没有选区则切到待输入样式
toggleIn = [env, read, patch =>
    sel = selectionIn $ env;
    #guard ((sel lo) < (sel hi));
    all = allFlagIn $ { list = ((env segRef) get), start = (sel lo), end = (sel hi), read = read };
    applyPatchIn $ env (sel lo) (sel hi) (patch $ (all == false))
    #else;
    togglePendingIn $ env read patch
];

// 颜色不是开关：有选区就刷区间，光标塌缩则并进待输入样式（下次输入落色）
setColorIn = [env, c =>
    sel = selectionIn $ env;
    patch = { color = c };
    #guard ((sel lo) < (sel hi));
    applyPatchIn $ env (sel lo) (sel hi) patch
    #else;
    (env pendingRef) set (merge $ patch (styleOf $ ((env pendingRef) get)));
    (env bump) $
];

// ---- IME 组合输入：以组合开始时的文本为基线反复替换 ----
applyCompose = [env, text =>
    base = (env composingBaseRef) get;
    #guard base;
    btext = base text;
    next = (btext slice 0 (base a)) + text + (btext slice (base f) (btext length));
    (env updateText) $ next;
    (env setSel) $ ((base a) + (text length)) ((base a) + (text length))
];

composeIn = [env, text =>
    #guard ((env composingBaseRef) get) != nil;
    applyCompose $ env text
    #else;
    sel = selectionIn $ env;
    (env composingBaseRef) set { text = ((env p) text), a = (sel lo), f = (sel hi) };
    (env pushUndo) $;
    applyCompose $ env text
];

// 组合被取消（Esc）：整轮窗口文本不是已上屏文本，必须回退到组合开始前的原文。
// 对齐 TS endComposition(true)：commit 只清状态、保留文本，restore 才还原。
// 不另进撤销栈——composeIn 首次已经压过一份组合前快照。
cancelComposeIn = [env =>
    base = (env composingBaseRef) get;
    #guard base;
    (env composingBaseRef) set nil;
    (env updateText) $ (base text);
    (env setSel) $ (base a) (base a)
    #else;
    nil
];

{
    applyPatchIn = applyPatchIn,
    toggleIn = toggleIn,
    setColorIn = setColorIn,
    composeIn = composeIn,
    cancelComposeIn = cancelComposeIn
}
