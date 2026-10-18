// ===== 项目配置（config.ooc）=====
// 解释器执行本文件，最后一条表达式返回配置对象。
// diagnostics：诊断级别策略（'off' | 'warning' | 'error'）。
// globals 成员只列本项目用到的全局对象名字（相当于 tsconfig 的 types 清单），
// RHS 裸名从注入的注册表解析出真实类型（Route A）：
//   storage / js / merge / console —— language 包 coreBridgeTypesSource
//   dom / text / html / fc / forEach —— ooc-mve-bridge 包 bridgeTypesSource
//   createSignal / memo / addEffect / createContext —— ooc-mve-bridge（运行时 wy-helper / mve-core）
// 运行时实现由 main.ts 注入，这里不再重复形状。

config = {
    diagnostics = {
        unknownType = 'off',
        typeMismatch = 'error',
        noImplicitAny = 'off'
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