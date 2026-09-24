// ===== 项目配置（config.ooc）=====
// 解释器执行本文件，最后一条表达式返回配置对象。
// globals 成员声明本项目的全局桥接对象：IDE 类型检查 / hover / 补全
// 都会按这份声明注入（运行时实现由宿主 JS 提供，这里只声明类型）。
// 按需增删标签 / 方法，签名方法用 '=>' 表达式体占位，不会被真正调用。

Component #type {
    class(props): Component,
    on(event): Component
};

Signal #type {
    get(): any,
    set(value): any,
    update(fn): any
};

Ref #type {
    get(): any,
    set(value): any,
    update(fn): any
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
    li(props): Component => js any
};

text = {
    apply(content): Component => js any
};

fc = {
    apply(fn): Component => js any
};

createSignal = {
    apply(initial): Signal => js any
};

storage = {
    ref(initial): Ref => js any
};

console = {
    log(message): any => js any,
    error(message): any => js any
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
        fc = fc,
        createSignal = createSignal,
        storage = storage,
        console = console,
        js = js
    }
};

config