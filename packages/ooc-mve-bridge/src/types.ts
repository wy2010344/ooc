/**
 * 桥接类型源（Route A）：宿主包自持 .ooc 类型声明（相当于 TS 的 dom.d.ts），
 * 调用方用 language 的 loadGlobalsTypesFromSource 解析成 Map<string, TypeInfo>，
 * 传给 createObjectOrientedCServices 的 globalsTypes / createTypeCheckAction。
 * 运行时实现见 src/dom.ts / src/fc.ts，这里只声明类型（签名方法不落地）。
 * dom 标签签名：(props, ...children) => DComponent，与 wy-dom-helper 的 tag 一致。
 * 宽泛语义：dom 运行时是 JS Proxy，任意标签名都暴露方法并接受 lambda children；
 * 此处只枚举常见标签供补全，未知标签在类型上静默退化为 any，无需 methodNotFound。
 */
import type { LangiumCoreServices } from 'langium'
import { loadGlobalsTypesFromSource } from 'object-oriented-c-language'
import type { TypeInfo } from 'object-oriented-c-language'

/** ooc-mve-bridge 的 .ooc 类型源：视图层组件（dom/text/html/fc/forEach） */
export const bridgeTypesSource = `// ooc-mve-bridge 类型源（视图层组件）
// 运行时实现见 src/dom.ts / src/fc.ts。
Component #type {
    class(props): Component,
    on(event): Component
};

dom = {
    a(props, ...children): Component,
    abbr(props, ...children): Component,
    address(props, ...children): Component,
    area(props, ...children): Component,
    article(props, ...children): Component,
    aside(props, ...children): Component,
    audio(props, ...children): Component,
    b(props, ...children): Component,
    base(props, ...children): Component,
    bdi(props, ...children): Component,
    bdo(props, ...children): Component,
    big(props, ...children): Component,
    blockquote(props, ...children): Component,
    body(props, ...children): Component,
    br(props, ...children): Component,
    button(props, ...children): Component,
    canvas(props, ...children): Component,
    caption(props, ...children): Component,
    cite(props, ...children): Component,
    code(props, ...children): Component,
    col(props, ...children): Component,
    colgroup(props, ...children): Component,
    data(props, ...children): Component,
    datalist(props, ...children): Component,
    dd(props, ...children): Component,
    del(props, ...children): Component,
    details(props, ...children): Component,
    dfn(props, ...children): Component,
    dialog(props, ...children): Component,
    div(props, ...children): Component,
    dl(props, ...children): Component,
    dt(props, ...children): Component,
    em(props, ...children): Component,
    embed(props, ...children): Component,
    fieldset(props, ...children): Component,
    figcaption(props, ...children): Component,
    figure(props, ...children): Component,
    footer(props, ...children): Component,
    form(props, ...children): Component,
    h1(props, ...children): Component,
    h2(props, ...children): Component,
    h3(props, ...children): Component,
    h4(props, ...children): Component,
    h5(props, ...children): Component,
    h6(props, ...children): Component,
    head(props, ...children): Component,
    header(props, ...children): Component,
    hgroup(props, ...children): Component,
    hr(props, ...children): Component,
    html(props, ...children): Component,
    i(props, ...children): Component,
    iframe(props, ...children): Component,
    img(props, ...children): Component,
    input(props, ...children): Component,
    ins(props, ...children): Component,
    kbd(props, ...children): Component,
    keygen(props, ...children): Component,
    label(props, ...children): Component,
    legend(props, ...children): Component,
    li(props, ...children): Component,
    link(props, ...children): Component,
    main(props, ...children): Component,
    map(props, ...children): Component,
    mark(props, ...children): Component,
    menu(props, ...children): Component,
    menuitem(props, ...children): Component,
    meta(props, ...children): Component,
    meter(props, ...children): Component,
    nav(props, ...children): Component,
    noindex(props, ...children): Component,
    noscript(props, ...children): Component,
    object(props, ...children): Component,
    ol(props, ...children): Component,
    optgroup(props, ...children): Component,
    option(props, ...children): Component,
    output(props, ...children): Component,
    p(props, ...children): Component,
    param(props, ...children): Component,
    picture(props, ...children): Component,
    pre(props, ...children): Component,
    progress(props, ...children): Component,
    q(props, ...children): Component,
    rp(props, ...children): Component,
    rt(props, ...children): Component,
    ruby(props, ...children): Component,
    s(props, ...children): Component,
    samp(props, ...children): Component,
    slot(props, ...children): Component,
    script(props, ...children): Component,
    section(props, ...children): Component,
    select(props, ...children): Component,
    small(props, ...children): Component,
    source(props, ...children): Component,
    span(props, ...children): Component,
    strong(props, ...children): Component,
    style(props, ...children): Component,
    sub(props, ...children): Component,
    summary(props, ...children): Component,
    sup(props, ...children): Component,
    table(props, ...children): Component,
    template(props, ...children): Component,
    tbody(props, ...children): Component,
    td(props, ...children): Component,
    textarea(props, ...children): Component,
    tfoot(props, ...children): Component,
    th(props, ...children): Component,
    thead(props, ...children): Component,
    time(props, ...children): Component,
    tr(props, ...children): Component,
    track(props, ...children): Component,
    u(props, ...children): Component,
    ul(props, ...children): Component,
    var(props, ...children): Component,
    video(props, ...children): Component,
    wbr(props, ...children): Component,
    webview(props, ...children): Component
};

text = {
    apply(content): Component
};

html = {
    apply(content): Component
};

fc = {
    apply(...args): Component
};

forEach = {
    apply(config): Component
};

config = {
    globals = {
        dom = dom,
        text = text,
        html = html,
        fc = fc,
        forEach = forEach
    }
};

config
`

/**
 * 创建桥接对象的类型映射（Route A loader，复用 language 的 collectConfigGlobals 管线）。
 * 返回 Map<string, TypeInfo>，可传给 createObjectOrientedCServices / createTypeCheckAction。
 */
export function createBridgeGlobalsTypes(
  services?: LangiumCoreServices,
): Map<string, TypeInfo> | undefined {
  return loadGlobalsTypesFromSource(bridgeTypesSource, services)
}