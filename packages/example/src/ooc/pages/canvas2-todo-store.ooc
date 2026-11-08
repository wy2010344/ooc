// 待办看板数据层：唯一可信源 = historySig（past / todos / future 一份状态）。
// 其余全是读取时派生：可见列表、统计、下一个 id、选中项文本都不另存副本。
// 页面 / 行组件只读信号、只调这里导出的操作；不探测任何对象成员。

#import { bindSignal, rgba } '../bridge.ts';

rowHeight = 44;
rowGap = 6;

maxOf = [a, b => #guard (a > b); a #else; b];

// 种子 10 条：视口约 328px，能滚起来
seedTodos = (Array of
    { id = 1, text = '梳理 canvas2 的节点消息清单', done = true, tag = 'CORE' }
    { id = 2, text = '把滚动容器改成只发消息', done = true, tag = 'CORE' }
    { id = 3, text = '给行加 hover 与选中态', done = false, tag = 'UI' }
    { id = 4, text = '空态提示要走同一条绘制路径', done = false, tag = 'UI' }
    { id = 5, text = '撤销 / 重做用快照栈', done = true, tag = 'CORE' }
    { id = 6, text = '标签配色跟主题一起切换', done = false, tag = 'UI' }
    { id = 7, text = '滚轮必须 stopPropagation', done = false, tag = 'TEST' }
    { id = 8, text = '内容高度由可见条数算出来', done = true, tag = 'TEST' }
    { id = 9, text = '进度条按完成比例取整', done = false, tag = 'DOCS' }
    { id = 10, text = '删除按钮要把点击吞掉', done = false, tag = 'DOCS' }
);

// 单一可变源：历史栈与当前列表放在同一份状态里，写入点只有 commit / undo / redo
historySig = bindSignal $ { past = (Array of), todos = seedTodos, future = (Array of) };

// 与历史无关的 UI 状态（各自独立、互不派生）
filterSig = bindSignal $ 'all';
selectedSig = bindSignal $ 0;
hoverSig = bindSignal $ 0;
themeSig = bindSignal $ 'light';

todosNow = [ (historySig $) todos ];
filterNow = [ filterSig $];
selectedNow = [ selectedSig $];
hoverNow = [ hoverSig $];
themeNow = [ themeSig $];

setFilter = [v => filterSig $ v];
selectTodo = [id => selectedSig $ id];
hoverTodo = [id => hoverSig $ id];

toggleTheme = [
    #guard (themeSig $) == 'light';
    themeSig $ 'dark'
    #else;
    themeSig $ 'light'
];

// 当前过滤下的可见列表（all / active / done）
visibleTodos = [
    list = historySig $ / todos;
    f = filterSig $;
    #guard (f == 'active');
    list filter [t => (t done) == false]
    #guard (f == 'done');
    list filter [t => (t done) == true]
    #else;
    list
];

doneCountOf = [list => (list filter [t => (t done)]) length];

progressOf = [
    list = historySig $ / todos;
    #guard ((list length) > 0);
    ((doneCountOf $ list) * 100) div (list length)
    #else;
    0
];

statsText = [
    list = historySig $ / todos;
    '完成 ${(doneCountOf $ list)} / ${(list length)}'
];

findTodo = [id =>
    list = historySig $ / todos;
    list find [t => (t id) == id]
];

// 选中项文本：可能没有选中（nil 时不乱发消息）
selectedTextOf = [
    t = findTodo $ (selectedSig $);
    #guard t != nil;
    t text
    #else;
    '未选中'
];

// 下一个 id 由当前列表派生（不再单独维护计数器）
maxIdOf = [list => list reduce [acc, t => (maxOf $ acc (t id))] 0];
nextIdOf = [list => (maxIdOf $ list) + 1];

hasTodoOf = [list, id => (id != 0) && ((list find [t => (t id) == id]) != nil)];

// 列表变化后清理悬空的选中 / 悬停 id
pruneSelected = [list => #guard (hasTodoOf $ list (selectedSig $)) == false; selectedSig $ 0];
pruneHover = [list => #guard (hasTodoOf $ list (hoverSig $)) == false; hoverSig $ 0];
pruneStop = [list => pruneSelected $ list; pruneHover $ list];

// 唯一写入口：先入历史栈、清空 redo，再落新列表
commit = [mutate =>
    h = historySig $;
    next = mutate $ (h todos);
    historySig $ {
        past = (Array of ...(h past) (h todos)),
        todos = next,
        future = (Array of)
    };
    pruneStop $ next
];

toggleTodo = [id =>
    commit $ [list => list map [t => #guard ((t id) == id); { ...t, done = ((t done) == false) } #else; t]]
];

removeTodo = [id =>
    commit $ [list => list filter [t => (t id) != id]]
];

clearDone = [
    commit $ [list => list filter [t => (t done) == false]]
];

addTodo = [
    list = historySig $ / todos;
    id = nextIdOf $ list;
    item = { id = id, text = '新任务 #${id}', done = false, tag = 'NEW' };
    commit $ [it => (Array of ...it item)]
];

undoTodo = [
    h = historySig $;
    past = h past;
    #guard ((past length) > 0);
    prev = past at ((past length) - 1);
    historySig $ {
        past = past slice 0 ((past length) - 1),
        todos = prev,
        future = (Array of (h todos) ...(h future))
    };
    pruneStop $ prev
];

redoTodo = [
    h = historySig $;
    fut = h future;
    #guard ((fut length) > 0);
    next = fut at 0;
    historySig $ {
        past = (Array of ...(h past) (h todos)),
        todos = next,
        future = fut slice 1 (fut length)
    };
    pruneStop $ next
];

canUndo = [ (((historySig $) past) length) > 0];
canRedo = [ (((historySig $) future) length) > 0];

// 两套配色（light / dark）
paletteOf = [theme =>
    #guard (theme == 'dark');
    {
        page = rgba $ 9 9 11 255,
        card = rgba $ 24 24 27 255,
        cardHover = rgba $ 39 39 42 255,
        cardDone = rgba $ 20 20 23 255,
        border = rgba $ 39 39 42 255,
        borderStrong = rgba $ 82 82 91 255,
        text = rgba $ 244 244 245 255,
        muted = rgba $ 161 161 170 255,
        accent = rgba $ 96 165 250 255,
        accentSoft = rgba $ 30 58 138 255,
        onAccent = rgba $ 9 9 11 255,
        track = rgba $ 63 63 70 255,
        thumb = rgba $ 113 113 122 255,
        danger = rgba $ 248 113 113 255,
        success = rgba $ 74 222 128 255,
        tagBg = rgba $ 30 41 59 255,
        tagText = rgba $ 147 197 253 255
    }
    #else;
    {
        page = rgba $ 250 250 250 255,
        card = rgba $ 255 255 255 255,
        cardHover = rgba $ 244 244 245 255,
        cardDone = rgba $ 248 250 252 255,
        border = rgba $ 228 228 231 255,
        borderStrong = rgba $ 212 212 216 255,
        text = rgba $ 24 24 27 255,
        muted = rgba $ 113 113 122 255,
        accent = rgba $ 37 99 235 255,
        accentSoft = rgba $ 219 234 254 255,
        onAccent = rgba $ 255 255 255 255,
        track = rgba $ 228 228 231 255,
        thumb = rgba $ 161 161 170 255,
        danger = rgba $ 220 38 38 255,
        success = rgba $ 22 163 74 255,
        tagBg = rgba $ 239 246 255 255,
        tagText = rgba $ 37 99 235 255
    }
];
