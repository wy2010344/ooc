// 编辑器的对外句柄（工具栏 / 隐藏输入层 / 舞台按消息调用）。
// 所有状态都从 h（editable.ooc 组装的共享环境）读取，这里只做消息面。

#import { syncInputPosition } './host.ts';
#import { when } './when.ooc';
#import { selectionIn, replaceRangeIn, keyInsertIn, handleKeyIn } './editable-keys.ooc';
#import { composeIn, toggleIn, applyPatchIn } './editable-style.ooc';
#import {
    selectionRangeOf, selectionText, selectionClear, selectionClearPointer, selectionSetActive
} './selection.ooc';

// 复制 / 剪切优先取全局选区（跨节点时是各节点文本拼接）
copyLocal = [h =>
    sel = selectionIn $ (h editEnv);
    #guard ((sel lo) < (sel hi));
    ((h p) text slice (sel lo) (sel hi))
    #else;
    nil
];

cutLocal = [h =>
    sel = selectionIn $ (h editEnv);
    #guard ((sel lo) < (sel hi));
    value = (h p) text slice (sel lo) (sel hi);
    replaceRangeIn $ { env = (h editEnv), start = (sel lo), end = (sel hi), value = '' };
    value
    #else;
    nil
];

// 跨节点剪切不逐节点删除：只复制并清选区，避免只删掉一半
cutExternal = [h, all =>
    r = selectionRangeOf $ (h selectable);
    selectionClear $ nil;
    #guard r;
    replaceRangeIn $ { env = (h editEnv), start = (r at 0), end = (r at 1), value = '' };
    all
    #else;
    all
];

cutOut = [h =>
    all = selectionText $ nil;
    #guard all;
    cutExternal $ h all
    #else;
    cutLocal $ h
];

makeHandleIn = [h =>
    // 先把共享函数提到局部，对象成员里再按消息调用
    undoCore = h undo;
    redoCore = h redo;
    {
        focus {
            (h focusRef) set true;
            (h publishNow) $ nil;
            (h bump) $;
            (h startBlink) $;
            syncInputPosition $
        },
        blur {
            (h focusRef) set false;
            // 失焦即收起本地选区（否则点空白后高亮还留在原地）；
            // 工具栏按钮在 mousedown 里 preventDefault，不会走到这里，样式操作不受影响
            f = ((h selRef) get) at 1;
            (h selRef) set (Array of f f);
            selectionSetActive $ nil;
            (h bump) $;
            (h stopBlink) $
        },
        // 销毁时只停定时器：此时可能正处于批次监听阶段，写信号会撞 didSet 保护
        destroy { (h stopBlink) $ },
        undo { undoCore $ },
        redo { redoCore $ },
        canUndo { (((h undoRef) get) length) > 0 },
        canRedo { (((h redoRef) get) length) > 0 },
        isFocused { (h focusRef) get },
        handleKey(e) { (h adoptIn) $ nil; handleKeyIn $ (h editEnv) e },
        // 双击选词 / 三击选段：先摘掉全局指针会话，否则塌缩的按住会话会压住这次选区
        selectRange(a, f) {
            (h focusRef) set true;
            (h startBlink) $;
            selectionClearPointer $ nil;
            (h setSel) $ a f
        },
        selectAll { selectionClear $ nil; (h setSel) $ 0 (((h p) text) length) },
        copySel {
            all = selectionText $ nil;
            #guard all;
            all
            #else;
            copyLocal $ h
        },
        cutSel { cutOut $ h },
        pasteText(t) {
            value = when $ ((h p) singleLine) ((t split '\n') join ' ') t;
            keyInsertIn $ (h editEnv) value;
            syncInputPosition $
        },
        onComposing(t, cursor) { composeIn $ (h editEnv) t },
        commitComposingText(t) {
            composeIn $ (h editEnv) t;
            (h composingBaseRef) set nil
        },
        selectionRange {
            sel = selectionIn $ (h editEnv);
            Array of (sel lo) (sel hi)
        },
        toggleBold { toggleIn $ (h editEnv) [st => st bold] [on => { bold = on }] },
        toggleItalic { toggleIn $ (h editEnv) [st => st italic] [on => { italic = on }] },
        toggleUnderline { toggleIn $ (h editEnv) [st => st underline] [on => { underline = on }] },
        toggleLineThrough { toggleIn $ (h editEnv) [st => st lineThrough] [on => { lineThrough = on }] },
        setColor(c) {
            sel = selectionIn $ (h editEnv);
            applyPatchIn $ (h editEnv) (sel lo) (sel hi) { color = c }
        },
        inputOverlay {
            node = (h nodeRef) get;
            index = (((h selRef) get) at 1);
            para = (h paraOf) $;
            #guard node;
            (h overlayCore) $ node para index
            #else;
            nil
        }
    }
];

{ makeHandleIn = makeHandleIn }
