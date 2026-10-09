// tsgen 公共工具：AST 判别辅助。
import type { Type } from 'object-oriented-c-language'

export function isRef(n: any): boolean {
  return n?.$type === 'Ref'
}

/** 类型标注节点是否为真实的 Type 节点（区别于字符串占位）。 */
export function isTypeRef(t: unknown): t is Type {
  return !!(t && typeof t === 'object' && (t as Type).$type === 'Type')
}