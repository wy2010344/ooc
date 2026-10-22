// canvas-kit.ooc — 画布版小组件：统计卡 / 按钮 / 进度条 / 标题
// 与 DOM 组件同构：fc + props(merge 默认值) + 剩余参数 children；
// 差异只在绘制：draw 里用 canvasDraw 操作 this（当前节点），坐标是节点本地坐标。
// 颜色是 canvasRender 的 ColorInt（rgba 打包整数），与 Tailwind 令牌同色系。
#import { fc, canvas, canvasDraw, flex, grow, rgba, readValue, merge, bindSignal, dark } '../bridge.ts';
#import { when } './utils.ooc';

// 颜色令牌：浅色 / 深色两套，绘制时按当前主题取（dark 读取会触发画布重绘）
canvasInk = {
    light = (rgba $ 24 24 27 255),
    dark = (rgba $ 250 250 250 255)
};
canvasMuted = {
    light = (rgba $ 113 113 122 255),
    dark = (rgba $ 161 161 170 255)
};
canvasLine = {
    light = (rgba $ 228 228 231 255),
    dark = (rgba $ 255 255 255 26)
};
canvasSurface = {
    light = (rgba $ 255 255 255 255),
    dark = (rgba $ 24 24 27 255)
};
canvasSoft = {
    light = (rgba $ 244 244 245 255),
    dark = (rgba $ 39 39 42 255)
};
canvasAccent = {
    light = (rgba $ 24 24 27 255),
    dark = (rgba $ 250 250 250 255)
};
canvasAccentHover = {
    light = (rgba $ 63 63 70 255),
    dark = (rgba $ 212 212 216 255)
};
canvasAccentOn = {
    light = (rgba $ 250 250 250 255),
    dark = (rgba $ 24 24 27 255)
};
canvasTrack = {
    light = (rgba $ 228 228 231 255),
    dark = (rgba $ 39 39 42 255)
};

// 按当前主题取色：dark 是响应式信号，画布 draw 期间读取即可订阅重绘
themeColor = [token =>
    when $ (dark $) (token dark) (token light)
];

// 标题块：标题 + 说明（两块文本节点，纵向 flex）
canvasHeaderDefaults = { title = '', description = '' };

CanvasHeader = fc $ [ctx, props =>
    p = merge $ props canvasHeaderDefaults;
    (canvas rect (merge $ p {
        height = 56,
        layout = (flex $ { direction = 'y', alignItem = 'stretch', alignFix = true, gap = 6 })
    })
        (canvas rect {
            height = 24,
            draw(ctx2){ canvasDraw text this ctx2 (p title) 0 18 { size = 18, weight = 700, color = (themeColor $ canvasInk) } }
        })
        (canvas rect {
            height = 18,
            draw(ctx2){ canvasDraw text this ctx2 (p description) 0 13 { size = 12, weight = 400, color = (themeColor $ canvasMuted) } }
        })
    ) $ ctx
];

// 统计卡：说明 + 大数字 + 提示；可点击（按下变底色）
// value 是 lambda/信号（readValue 在读的时候展开），静态值写 [42]
canvasStatDefaults = {
    label = '',
    value = [0],
    hint = '',
    onClick(e){ nil }
};

CanvasStat = fc $ [ctx, props =>
    p = merge $ props canvasStatDefaults;
    pressed = bindSignal $ false;
    (canvas rect (merge $ p {
        height = 116,
        padding = 16,
        exts = (Array of (grow $ { growX = 1 })),
        layout = (flex $ { direction = 'y', alignItem = 'stretch', alignFix = true, directionJustify = 'center', gap = 8 }),
        draw(ctx2){
            canvasDraw round this ctx2 14 (when $ (pressed $) (themeColor $ canvasSoft) (themeColor $ canvasSurface));
            canvasDraw strokeRound this ctx2 14 (when $ (pressed $) (themeColor $ canvasInk) (themeColor $ canvasLine)) 1;
            canvasDraw fillRound ctx2 16 20 3 28 2 (themeColor $ canvasAccent);
        },
        mouseDown(e){ pressed $ true },
        mouseUp(e){ pressed $ false },
        mouseClick(e){ p onClick e }
    })
        (canvas rect {
            height = 16,
            draw(ctx2){ canvasDraw text this ctx2 (p label) 24 12 { size = 12, weight = 500, color = (themeColor $ canvasMuted) } }
        })
        (canvas rect {
            height = 32,
            draw(ctx2){ canvasDraw text this ctx2 (p value) 24 26 { size = 26, weight = 700, color = (themeColor $ canvasInk) } }
        })
        (canvas rect {
            height = 14,
            draw(ctx2){ canvasDraw text this ctx2 (p hint) 24 10 { size = 11, weight = 400, color = (themeColor $ canvasMuted) } }
        })
    ) $ ctx
];

// 按钮：固定宽高、文字居中；按下换深色
canvasButtonDefaults = { label = '', width = 120, height = 40, onClick(e){ nil } };

CanvasButton = fc $ [ctx, props =>
    p = merge $ props canvasButtonDefaults;
    pressed = bindSignal $ false;
    (canvas rect (merge $ p {
        width = (p width),
        height = (p height),
        layout = (flex $ { direction = 'x', alignItem = 'center', alignFix = true, directionJustify = 'center' }),
        draw(ctx2){
            w = (this outerWidth);
            h = (this outerHeight);
            canvasDraw round this ctx2 10 (when $ (pressed $) (themeColor $ canvasAccentHover) (themeColor $ canvasAccent));
            canvasDraw text this ctx2 (p label) (w div 2) (h div 2) { size = 13, weight = 600, color = (themeColor $ canvasAccentOn), align = 'center', baseline = 'middle' }
        },
        mouseDown(e){ pressed $ true },
        mouseUp(e){ pressed $ false },
        mouseClick(e){ p onClick e }
    })) $ ctx
];

// 进度条：value/max 驱动宽度（信号变化 → 帧回调 → 重绘）
canvasProgressDefaults = { value = [0], max = 10 };

CanvasProgress = fc $ [ctx, props =>
    p = merge $ props canvasProgressDefaults;
    (canvas rect (merge $ p {
        height = 10,
        exts = (Array of (grow $ { growX = 1 })),
        draw(ctx2){
            w = (this outerWidth);
            h = (this outerHeight);
            n = readValue $ (p value);
            m = (p max);
            ratio = when $ (n > m) 1 (n div m);
            canvasDraw fillRound ctx2 0 0 w h (h div 2) (themeColor $ canvasTrack);
            canvasDraw fillRound ctx2 0 0 (w * ratio) h (h div 2) (themeColor $ canvasAccent);
        }
    })) $ ctx
];

{
    CanvasHeader = CanvasHeader,
    CanvasStat = CanvasStat,
    CanvasButton = CanvasButton,
    CanvasProgress = CanvasProgress
}
