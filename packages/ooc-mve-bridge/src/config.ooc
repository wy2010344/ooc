// ===== 桥接类型声明（config.ooc）=====
// 本包声明的全局桥接对象类型：playground 的虚拟文件系统预加载本文件
// 作为 config.ooc，createTypeCheckAction 按目录收集 globals 成员注入类型。
// 运行时实现由宿主 JS（language / mve-dom / wy-helper / preview 薄层）提供。
// 标签 / 方法按需增删，签名方法 '=>' 表达式体不会被真正调用。

Component #type {
    class(props): Component,
    on(event): Component
};

Signal #type<T> {
    get: T,
    set(value: T): any,
    update(fn): any
};

Ref #type<T> {
    get: T,
    set(value: T): any,
    update(fn): any
};

Callable #type {
    $(...args): any
};

// 读/写持有者：createSignal / storage ref 都满足
Holder #type<T> {
    get: T,
    set(value: T): any
};

// 绑定函数：无参读、单参写
Bound #type<T> {
    $: T,
    $(value: T): T
};

dom = {
    div(props): Component => js any,
    span(props): Component => js any,
    p(props): Component => js any,
    a(props): Component => js any,
    h1(props): Component => js any,
    h2(props): Component => js any,
    h3(props): Component => js any,
    button(props): Component => js any,
    input(props): Component => js any,
    img(props): Component => js any,
    ul(props): Component => js any,
    li(props): Component => js any,
    form(props): Component => js any,
    select(props): Component => js any,
    textarea(props): Component => js any,
    option(props): Component => js any
};

text = {
    $(content): Component => js any,
    bind(content): Component => js any
};

html = {
    $(source): Component => js any
};

canvas = {
    stage(props, ...children): Component => js any,
    node(props, ...children): Component => js any,
    rect(props, ...children): Component => js any,
    rich(props, ...children): Component => js any,
    wrapped(props, ...children): Component => js any,
    editable(props, ...children): Component => js any,
    image(props, ...children): Component => js any,
    scroll(props, ...children): Component => js any
};

canvasDraw = {
    fill(node, ctx, color): any => js any,
    fillInner(node, ctx, color): any => js any,
    stroke(node, ctx, color, width): any => js any,
    strokeInner(node, ctx, color, width): any => js any,
    round(node, ctx, radius, color): any => js any,
    roundInner(node, ctx, radius, color): any => js any,
    strokeRound(node, ctx, radius, color, width): any => js any,
    strokeRoundInner(node, ctx, radius, color, width): any => js any,
    oval(node, ctx, color): any => js any,
    strokeOval(node, ctx, color, width): any => js any,
    ring(node, ctx, gap, radius, color, width): any => js any,
    fillRound(ctx, x, y, w, h, radius, color): any => js any,
    text(node, ctx, value, x, y, style): any => js any
};

// three 组件（mve-three 薄桥接）：stage 是持有 WebGLRenderer 的 div，其余是 3D 节点
// 变换/材质属性（x/y/z、rotationX/Y/Z、scale、color、roughness…）写 lambda 即响应式
three = {
    stage(props, ...children): Component => js any,
    group(props, ...children): Component => js any,
    box(props, ...children): Component => js any,
    sphere(props, ...children): Component => js any,
    cylinder(props, ...children): Component => js any,
    torus(props, ...children): Component => js any,
    plane(props, ...children): Component => js any,
    ambient(props, ...children): Component => js any,
    directional(props, ...children): Component => js any,
    point(props, ...children): Component => js any,
    grid(props, ...children): Component => js any,
    axes(props, ...children): Component => js any,
    label(props, ...children): Component => js any
};

readValue = {
    $(value): any => js any
};

// 主题：dark 无参读、toggleTheme 无参切换
dark = {
    $: bool
};

toggleTheme = {
    $: bool
};

flex = {
    $(props): any => js any
};

grow = {
    $(props): any => js any
};

align = {
    $(props): any => js any
};

ignoreFlex = {
    $(props): any => js any
};

rgba = {
    $(r, g, b, a): any => js any
};

colorToCSS = {
    $(color): any => js any
};

layoutSize = {
    $(value, fromInside): any => js any
};

layoutSizeDirection = {
    $(direction, value, fromInside): any => js any
};

fc = {
    $(fn): Component => js any
};

forEach = {
    $(region): Component => js any
};

createSignal = {
    $<T>(initial: T): Signal<T> => js any
};

multiBind = {
    $<T>(holder: Holder<T>): Bound<T> => js any
};

bindSignal = {
    $<T>(initial: T): Bound<T> => js any
};

bindRef = {
    $<T>(initial: T): Bound<T> => js any
};

memo = {
    $(fn): Signal<any> => js any
};

addEffect = {
    $(fn): any => js any
};

createContext = {
    $(...args): any => js any
};

storage = {
    ref<T>(initial: T): Ref<T> => js any
};

js = {
    any(...args): any => js any,
    new(...args): any => js any,
    throw(message): any => js any
};

config = {
    diagnostics = {
    },
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
        storage = storage,
        js = js,
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