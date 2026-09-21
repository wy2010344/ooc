/**
 * OOC #classDef 类归属标记：类对象指向自身、实例指向所属类，
 * include 据此判定「v 是否是该类的实例」。定义在本模块避免与
 * runtime.ts 循环依赖（本文件除类型外无任何导入）。
 */
export const OOC_CLASS = Symbol('ooc:class')

export const objectDefine = {
  '=='(sender: any, v: any) {
    return sender == v
  },
  '!='(sender: any, v: any) {
    return sender != v
  },
  '!!'(sender: any) {
    return Boolean(sender)
  },
  '~!'(sender: any) {
    return !Boolean(sender)
  },
  '&&'(sender: any, v: any) {
    return sender && v
  },
  '||'(sender: any, v: any) {
    return sender || v
  },
  // not：逻辑取反，等价 JS 的 !x，对一切值可用（对象消息或原始值兜底）
  'not'(sender: any) {
    return !Boolean(sender)
  },
  // include：统一「容器成员判定」。对类对象回答「sender 是否是 v 的实例/类」，
  // 对数组/Set/Map 回答「是否包含成员 v」。一条消息、鸭子派发，无需改语法。
  // 返回 boolean；原始值作为 sender 时恒为当前值自身（迷你表单例）。
  'include'(sender: any, v: any) {
    // OOC #classDef 类对象：sender 是类（或实例）、v 归属同一类 → 类成员判定
    const brand = sender ? (sender as any)[OOC_CLASS] : undefined
    if (brand && (v as any)?.[OOC_CLASS] === brand) {
      return true
    }
    if (typeof sender == 'function') {
      // 函数型「类对象」：v 的类/祖先链上有没有 sender（含数组、Date 等内建类）
      return v instanceof sender
    }
    if (sender && typeof sender.includes == 'function') {
      // 数组等容器：成员包含判定
      return sender.includes(v)
    }
    if (sender && typeof sender.has == 'function') {
      // Set/Map 等：键包含判定
      return sender.has(v)
    }
    // 其余对象/原始值：只包含自身（配对==的无害兜底）
    return sender === v
  },
}
