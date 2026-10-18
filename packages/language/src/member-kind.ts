// 对象成员分类的共享判定：解释器（interpreter/runtime.ts）、编译器（cli tsgen/expr.ts）、
// 校验器（member-lint.ts）必须口径一致，故集中在这里。
import type { Expression } from './generated/ast.js'

/**
 * 「方法函数」标记键。`=>` 方法编译成的 JS 函数附带这个符号属性，运行时（__send /
 * 宿主桥接）据此区分「OOC 方法（应发送消息调用）」与「lambda 值（原样返回）」。
 * 用 Symbol.for 全局注册表：编译产物（_ooc_runtime.ts）与宿主桥接（如 dom.ts）
 * 读到的必须是同一个符号。
 */
export const OOC_METHOD: unique symbol = Symbol.for('ooc:method')

/**
 * 「直接调用」成员的归一名字。OOC surface 里这个成员一律写成 `$`：定义键、消息名、
 * 中缀运算符三处都用 `$`。运行时/codegen/类型检查/LSP 一律经这里归一
 * （宿主 JS 侧成员名仍是 'apply'）。
 */
export const APPLY_NAME = 'apply'

/** 归一「中缀运算符名」：`$` 是直接调用运算符（`a $ b` ≡ 调用 a 的 APPLY_NAME），其余原样。 */
export function getInfixName(infix: string): string {
  return infix === '$' ? APPLY_NAME : infix
}

/** 成员名的 OOC surface 展示名：APPLY_NAME 展示为 `$`，其余原样（hover/补全/签名提示用）。 */
export function displayMemberName(name: string): string {
  return name === APPLY_NAME ? '$' : name
}

/** 纯原始字面量的结构化表示（str/num/bool/nil 四种） */
export type PrimitiveLiteral = {
  kind: 'str' | 'num' | 'bool' | 'nil'
  value: string | number | boolean | null
}

/**
 * 从「无消息的 MessageOrChain → 纯原始字面量」提取字面量；其余返回 undefined。
 * Pipling/Cast/Ref/StID/对象/lambda 一律不算——它们要么有副作用，要么每次求值
 * 产生新引用（如 `{ xs { [] } }`），不能当构造期常量。
 */
export function literalOfExpression(
  expr: unknown,
): PrimitiveLiteral | undefined {
  const e = expr as
    | { $type?: string; message?: unknown; primary?: { $type?: string; value?: unknown; parts?: unknown[] } }
    | undefined
  if (e?.$type !== 'MessageOrChain' || e.message) return undefined
  const p = e.primary
  switch (p?.$type) {
    case 'Str':
      // 含洞的模版字符串是动态值，不能当构造期常量
      if (p.parts?.length) return undefined
      return { kind: 'str', value: String(p.value) }
    case 'Num':
      return { kind: 'num', value: Number(p.value) }
    case 'Bool':
      return { kind: 'bool', value: p.value === 'true' }
    case 'Nil':
      return { kind: 'nil', value: null }
    default:
      return undefined
  }
}

/**
 * bind（`name = expr`）体是否是纯字面量——是则可直接编译成数据属性（构造期求值一次），
 * 否则走惰性 getter。`@{ ... }` 块一律视为计算式。
 */
export function literalOfBindBody(
  bindBody: unknown,
): PrimitiveLiteral | undefined {
  const body = bindBody as
    | { $type?: string; expression?: Expression }
    | undefined
  if (!body || body.$type === 'BindBlock') return undefined
  return literalOfExpression(body.expression)
}

/** 字面量 → JS 值（解释器构造期写入数据属性用）。 */
export function literalToValue(lit: PrimitiveLiteral): string | number | boolean | null {
  return lit.value
}

/** 字面量 → 可直接替换的源码文本（错误消息/再生成用）。 */
export function literalToText(lit: PrimitiveLiteral): string {
  switch (lit.kind) {
    case 'str':
      return `'${String(lit.value)}'`
    case 'num':
      return String(lit.value)
    case 'bool':
      return String(lit.value)
    case 'nil':
      return 'nil'
  }
}
