// OOC 常见对象通用消息。无继承：#classDef 类机制已移除，只有鸭子类型派发。
// 分支参数按 thunk 处理：lambda 调用求值，普通值原样返回。
const callThunk = (v: any) => (typeof v == 'function' ? v() : v)

export const objectDefine: Record<string, (sender: any, ...args: any[]) => any> = {
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
  // && || 保持消息语义（实参先求值，不短路）；惰性请用 and / or
  '&&'(sender: any, v: any) {
    return sender && v
  },
  '||'(sender: any, v: any) {
    return sender || v
  },
  // if：条件分支，只有命中的 lambda 会被调用
  if(sender: any, yes: any, no?: any) {
    return sender ? callThunk(yes) : no === undefined ? null : callThunk(no)
  },
  // unless：不满足才执行 no
  unless(sender: any, no: any) {
    return sender ? null : callThunk(no)
  },
  // and / or：惰性逻辑，右侧是 lambda 时按需调用
  and(sender: any, rhs: any) {
    return sender ? callThunk(rhs) : sender
  },
  or(sender: any, rhs: any) {
    return sender ? sender : callThunk(rhs)
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
