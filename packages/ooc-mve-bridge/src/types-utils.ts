/**
 * 视图层工具/信号类型的类型源片段（被 types.ts 拼进 bridgeTypesSource）。
 * 单独成文件只是为了控制单文件行数；只声明签名，实现见 src/fc.ts、wy-helper、mve-core。
 */
export const utilsTypesSource = `// 读值：lambda（GetValue）调用后返回，普通值原样返回
readValue = {
    $(value): any
};

flex = {
    $(props): any
};

grow = {
    $(props): any
};

align = {
    $(props): any
};

ignoreFlex = {
    $(props): any
};

rgba = {
    $(r, g, b, a): any
};

colorToCSS = {
    $(color): any
};

layoutSize = {
    $(value, fromInside): any
};

layoutSizeDirection = {
    $(direction, value, fromInside): any
};

fc = {
    $(...args): Component
};

forEach = {
    $(config): Component
};

createSignal = {
    $(initial): Signal
};

multiBind = {
    $(holder): Callable
};

memo = {
    $(fn): any
};

addEffect = {
    $(fn): any
};

createContext = {
    $(...args): any
};

// portal 弹层 + 浮层定位（Dropdown / Select / Dialog / Sheet 用）
createPop = {
    $(render): any
};

renderPop = {
    $: any
};

floating = {
    $(props, ...children): Component
};

hookTrackSignal = {
    $(get, set): any
};

// mve-icons 桥接：图标组件工厂（传入 { className } 返回 Component）
iconCheck = {
    $(props): Component
};

iconChevronDown = {
    $(props): Component
};

iconX = {
    $(props): Component
};

provideIconContext = {
    $(holder): any
};

config = {
    globals = {
        dom = dom,
        text = text,
        html = html,
        fc = fc,
        forEach = forEach,
        createSignal = createSignal,
        multiBind = multiBind,
        memo = memo,
        addEffect = addEffect,
        createContext = createContext,
        createPop = createPop,
        renderPop = renderPop,
        floating = floating,
        hookTrackSignal = hookTrackSignal,
        iconCheck = iconCheck,
        iconChevronDown = iconChevronDown,
        iconX = iconX,
        provideIconContext = provideIconContext,
        canvas = canvas,
        canvasDraw = canvasDraw,
        three = three,
        flex = flex,
        grow = grow,
        align = align,
        ignoreFlex = ignoreFlex,
        rgba = rgba,
        colorToCSS = colorToCSS,
        layoutSize = layoutSize,
        layoutSizeDirection = layoutSizeDirection,
        readValue = readValue
    }
};

config
`
