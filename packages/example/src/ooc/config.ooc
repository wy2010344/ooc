// ===== 项目配置（config.ooc）=====
// 解释器执行本文件，最后一条表达式返回配置对象。
// globals 成员只列本项目用到的全局对象名字（相当于 tsconfig 的 types 清单），
// 类型来自各宿主包自持的 .ooc 类型源（Route A）：
//   storage / js / ObjectValue —— language 包 coreBridgeTypesSource
//   dom / text / html / fc / forEach —— ooc-mve-bridge 包 bridgeTypesSource
//   createSignal / memo / addEffect / createContext / console —— 项目本地声明
// 运行时实现由 main.ts 注入，这里不再重复形状（删掉了旧版形状镜像）。

config = {
    diagnostics = {
    },
    globals = {
        storage = storage,
        js = js,
        fc = fc,
        createContext = createContext,
        dom = dom,
        html = html,
        text = text,
        createSignal = createSignal,
        memo = memo,
        addEffect = addEffect,
        forEach = forEach,
        console = console
    }
};

config