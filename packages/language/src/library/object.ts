// OOC 常见对象通用消息。无继承：#classDef 类机制已移除，只有鸭子类型派发。
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
  // include：统一「容器成员判定」。对数组/Set/Map 回答「是否包含成员 v」，
  // 对函数型 JS 类（Array 等）回答「v instanceof sender」。一条消息、鸭子派发。
  // 返回 boolean；原始值作为 sender 时恒为当前值自身（迷你表单例）。
  'include'(sender: any, v: any) {
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
