/**
 * 视图层工具/信号类型的类型源片段（被 types.ts 拼进 bridgeTypesSource）。
 * 单独成文件只是为了控制单文件行数；只声明签名，实现见 src/fc.ts、wy-helper、mve-core。
 */
export const utilsTypesSource = `// 读值：lambda（GetValue）调用后返回，普通值原样返回
readValue = {
    $(value): any
};

// 主题：dark 无参读、toggleTheme 无参切换
dark = {
    $: bool
};

toggleTheme = {
    $: bool
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

// 读/写持有者：wy-helper 的 Signal、storage 的 Ref 都满足这个形状
Holder #type<T> {
    get: T,
    set(value: T): any
};

// 绑定函数：无参读、单参写。两个 $ 重载让类型检查器按实参个数分流。
Bound #type<T> {
    $: T,
    $(value: T): T
};

createSignal = {
    $<T>(initial: T): Signal<T>
};

multiBind = {
    $<T>(holder: Holder<T>): Bound<T>
};

bindSignal = {
    $<T>(initial: T): Bound<T>
};

bindRef = {
    $<T>(initial: T): Bound<T>
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
        bindSignal = bindSignal,
        bindRef = bindRef,
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
        readValue = readValue,
        dark = dark,
        toggleTheme = toggleTheme
    }
};

config
`
