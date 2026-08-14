import type { AstNode } from 'langium'
import { isRef, type Expression, type MethodAll, type Param } from './generated/ast.js'
import { describeType, type TypeInfo } from './type-system.js'

/**
 * 推断参数类型
 */
export function inferParamType(p: Param): string {
  if (p.typeAnnotation) {
    return `: ${formatType(p.typeAnnotation)}`
  }
  return ': any'
}

/**
 * 推断表达式类型并转为字符串
 */
export function inferTypeString(checker: any, expr: Expression): string {
  const t = checker.inferType(expr)
  return `: ${formatTypeInfo(t)}`
}

export function formatType(type: any): string {
  if (!type) return 'any'
  if (typeof type === 'string') return type
  if (type.parts) {
    return type.parts.map((p: any) => {
      let name = p.name
      if (typeof name === 'string') return name
      if (name && typeof name === 'object' && 'value' in name) return String(name.value)
      return String(name)
    }).join(' | ')
  }
  return 'any'
}

export function formatTypeInfo(t: TypeInfo): string {
  if (!t) return 'any'
  return describeType(t)
}

/**
 * 获取 MethodAll 的方法名
 */
export function getMethodName(method: MethodAll): string | undefined {
  return extractMethodDefName(method.name)
}

/**
 * 从 MethodDefName 提取字符串值
 */
export function extractMethodDefName(nameNode: any): string | undefined {
  if (!nameNode) return undefined
  const innerName = nameNode.name
  if (!innerName) return undefined
  if (isRef(innerName)) return innerName.value
  if (innerName.$type === 'StID') return innerName.value.replace(/^"/, '').replace(/"$/, '')
  if (innerName.$type === 'Str') return innerName.value.replace(/^'/, '').replace(/'$/, '')
  return undefined
}

/**
 * 从文本中找到最后一个标识符
 */
export function findLastIdentifier(text: string): string | undefined {
  const match = text.match(/[a-zA-Z_][a-zA-Z0-9_]*\s*$/)
  if (!match) return undefined
  return match[0].trim()
}

/**
 * 判断节点是否在光标位置之前（含光标处）
 */
export function isBeforeCursor(node: AstNode, offset: number): boolean {
  const cst = (node as any).$cstNode
  if (!cst) return false
  return cst.offset + cst.length <= offset
}
