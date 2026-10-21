// vite 环境类型：让 TS 直接 import .ooc 模块（插件 transform 成纯 ES 模块，默认导出 = 模块最后一条表达式）。
/// <reference types="vite/client" />

declare module '*.ooc' {
    const value: any
    export default value
}
