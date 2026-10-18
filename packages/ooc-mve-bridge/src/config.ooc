// ===== 桥接类型声明（config.ooc）=====
// 本包声明的全局桥接对象类型：playground 的虚拟文件系统预加载本文件
// 作为 config.ooc，createTypeCheckAction 按目录收集 globals 成员注入类型。
// 运行时实现由宿主 JS（language / mve-dom / wy-helper / preview 薄层）提供。
// 标签 / 方法按需增删，签名方法 '=>' 表达式体不会被真正调用。

Component #type {
    class(props): Component,
    on(event): Component
};

Signal #type {
    get: any,
    set(value): any,
    update(fn): any
};

Ref #type {
    get: any,
    set(value): any,
    update(fn): any
};

Callable #type {
    $(...args): any
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

fc = {
    $(fn): Component => js any
};

forEach = {
    $(region): Component => js any
};

createSignal = {
    $(initial): Signal => js any
};

multiBind = {
    $(holder): Callable => js any
};

memo = {
    $(fn): Signal => js any
};

addEffect = {
    $(fn): any => js any
};

createContext = {
    $(...args): any => js any
};

storage = {
    ref(initial): Ref => js any
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
        memo = memo,
        addEffect = addEffect,
        createContext = createContext,
        storage = storage,
        js = js
    }
};

config