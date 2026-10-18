// utils.ooc —— 类名/属性工具（纯 OOC，无 TS）。
// cn    : clsx 风格合并（丢弃假值，空格连接）。
// pick  : 按 key 从类名表取类名，替代 cva 的 variant 解析（缺省由 merge 补全，故无需回退）。
// merge : 语言内置宿主桥（merge $ overrides defaults）——overrides 优先，未知消息按链查找；
//         成员用 `=`（计算绑定 = getter）定义时，函数值原样返回、不会被误当方法调用。
// noop  : 空回调占位。
// when  : 布尔分流（语言无三元）——cond 真返回 yes，否则 no；守卫分支末端即返回值。
#import { merge,js } '../bridge.ts';

cn = {
    $(...parts) {
        (parts filter [p => p]) join ' '
    }
};

// 通用消息 send：把接收者当对象按 key 动态取值（等价 JS 的 map[key]），
// 不再绕 js send 桥接——send 挂在所有对象上，语义就是「给对象发一条消息」。
pick = {
    $(map, key) {
     js send  map  key
    }
};

noop = {
    $(...args) {
        nil
    }
};

// 布尔分流：cond 为真返回 yes，否则返回 no（替代三元，供响应式 className 用）。
when = {
    $(cond, yes, no) {
        #guard cond;
        yes
        #else;
        no
    }
};

{ cn = cn, pick = pick, merge = merge, noop = noop, when = when }
