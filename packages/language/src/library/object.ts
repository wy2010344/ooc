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
}
