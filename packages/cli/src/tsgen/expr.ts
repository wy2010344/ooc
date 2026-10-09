// 表达式 → TS 代码生成。语义复刻解释器 evaluate.ts：MessageOrChain 求值 primary + 发消息，
// PiplingExpression 按 right 类型分派（级联 '/'、管道 '|'、中缀）。所有消息统一走 __send。
import type { Expression, Message, Primary } from 'object-oriented-c-language'
import { isRef, isTypeRef } from './util.js'

function primaryCode(p: Primary): string {
  switch (p.$type) {
    case 'Num':
      return String((p as any).value)
    case 'Str':
      return JSON.stringify((p as any).value)
    case 'Bool':
      return (p as any).value === 'true' ? 'true' : 'false'
    case 'Nil':
      return 'null'
    case 'Ref':
      return (p as any).value
    case 'StID':
      return JSON.stringify(((p as any).value as string).slice(1))
    case 'ObjectDef':
      return objectDefCode(p as any)
    case 'LambdaDef':
      return lambdaDefCode(p as any)
    default:
      return expressionCode(p as any)
  }
}

function messageName(m: Message): string {
  const v = (m.name as any).value
  if (v?.$type === 'StID') return v.value.slice(1)
  return v?.value ?? ''
}

function argsCode(m: Message): string {
  return (m.args || [])
    .map((a: Primary) => primaryCode(a))
    .join(', ')
}

/** MessageOrChain / 其它 Expression 的递归求值。 */
export function expressionCode(e: Expression): string {
  if (!e) return 'undefined'
  switch (e.$type) {
    case 'CastExpression':
      // 类型断言静态擦除：保留 as TS 类型（类型标注透传）
      return `(async () => ${expressionCode((e as any).expression)})() as any`
    case 'MessageOrChain': {
      const mc = e as any
      const p = mc.primary as Primary
      if (mc.message) {
        return `__send(${primaryCode(p)}, ${JSON.stringify(messageName(mc.message))}, [${argsCode(mc.message)}])`
      }
      return primaryCode(p)
    }
    default:
      return piplingCode(e)
  }
}

function piplingCode(e: any): string {
  const left = expressionCode(e.left)
  const r = e.right
  if (!r) {
    console.error('[tsgen] 未知表达式形态:', e.$type, Object.keys(e).filter((k) => !k.startsWith('$')))
    return left
  }
  switch (r.$type) {
    case 'MessageChainExt': {
      // '/' 级联符：对 left 求值结果的当前值发消息
      const mc = r.value
      return `__send(${left}, ${JSON.stringify(messageName(mc))}, [${argsCode(mc)}])`
    }
    case 'MessagePipRight': {
      const v = r.value
      if (v.$type === 'NamedExpression') {
        // '|' 管道：left 绑定为 param，再求值表达式
        return `((${v.param}) => (${expressionCode(v.expression)}))(${left})`
      }
      // '|' 管道：left 作为第一实参传给消息链
      const mc = v as any
      const chainArgs = [left, ...(mc.message.args || []).map((a: Primary) => primaryCode(a))]
      return `__send(${primaryCode(mc.primary)}, ${JSON.stringify(messageName(mc.message))}, [${chainArgs.join(', ')}])`
    }
    case 'MessageInfixRight':
      return `__send(${left}, ${JSON.stringify(r.infix)}, [${primaryCode(r.value)}])`
    default:
      return left
  }
}

function paramList(node: { params: Array<{ name: string; typeAnnotation?: unknown }>; restParam?: { name: string } }): string {
  const params = (node.params || []).map((p) => `${p.name}${typeAnnot(p.typeAnnotation)}`)
  if (node.restParam) {
    params.push(`...${node.restParam.name}`)
  }
  return params.join(', ')
}

function typeAnnot(t?: unknown): string {
  if (!t || !isTypeRef(t)) return ''
  return `: ${typeCode(t)}`
}

/** 类型标注 → TS 类型（Route 3：保留类型）。 */
export function typeCode(t: any): string {
  if (!t) return 'any'
  if (typeof t === 'string') return t
  const first = typeNameCode(t.first)
  const rest = (t.rest || [])
    .map((r: any, i: number) => `${t.seps?.[i] === '|' ? ' | ' : ' & '}${typeNameCode(r)}`)
    .join('')
  return first + rest
}

function typeNameCode(tn: any): string {
  if (typeof tn === 'string') return tn
  const name = tn.name?.$type ? (isRef(tn.name) ? tn.name.value : tn.name.value) : tn.name
  const args = (tn.typeArgs || []).map((a: any) => typeCode(a)).join(', ')
  return `${name}${args ? `<${args}>` : ''}`
}

/** 对象定义：ObjectDef → __createObject([...])，成员按解释器 runtime.ts 语义编译。 */
export function objectDefCode(obj: any): string {
  const entries = (obj.methods || [])
    .map((m: any) => methodCode(m))
    .filter((s: string | null): s is string => s !== null)
    .join(', ')
  return `__createObject([${entries}])`
}

function methodCode(m: any): string | null {
  const name = methodName(m.name)
  switch (m.$type) {
    case 'MethodBind':
      return `{ type: 'bind', name: ${JSON.stringify(name)}, value: ${expressionCode(m.expression)} }`
    case 'MethodBindMutable':
      return `{ type: 'mutable', name: ${JSON.stringify(name)}, value: ${expressionCode(m.expression)} }`
    default: {
      const body = m.body
      // 签名方法（无函数体）不烧录，与解释器一致
      if (!body) return null
      const fn = `function(${paramList(m)}){ ${bodyCode(body)} }`
      const guard = body.guardExpression
        ? `, guard: function(${paramList(m)}){ return ${expressionCode(body.guardExpression)} }`
        : ''
      const arity = m.params?.length ?? 0
      const rest = !!m.restParam
      return `{ type: 'call', name: ${JSON.stringify(name)}, fn: ${fn}, arity: ${arity}, rest: ${rest}${guard} }`
    }
  }
}

function methodName(n: any): string {
  const raw = n?.name
  if (!raw) return ''
  if (raw.$type === 'StID') return raw.value.slice(1)
  return raw.value ?? ''
}

function bodyCode(body: any): string {
  const lines: string[] = ['let __last = null;']
  for (const st of body.expressions || []) {
    if (st.$type === 'Assignment') {
      lines.push(`let ${st.name} = ${expressionCode(st.expression)};`)
    } else {
      lines.push(`__last = ${expressionCode(st)};`)
    }
  }
  lines.push('return __last;')
  return lines.join(' ')
}

/** lambda [x => body]：等价 { apply(...) {...} }，编译成真正的 JS 函数（解释器语义：既是值又是函数）。 */
function lambdaDefCode(e: any): string {
  if (!e || e.$type !== 'LambdaDef') return expressionCode(e)
  const params = (e.params || []).map((p: any) => `${p.name}${typeAnnot(p.typeAnnotation)}`)
  if (e.restParam) params.push(`...${e.restParam.name}`)
  const bodyLines: string[] = ['let __last = null;']
  for (const st of e.expressions || []) {
    if (st.$type === 'Assignment') {
      bodyLines.push(`let ${st.name} = ${expressionCode(st.expression)};`)
    } else {
      bodyLines.push(`__last = ${expressionCode(st)};`)
    }
  }
  bodyLines.push('return __last;')
  return `(function(${params.join(', ')}){ ${bodyLines.join(' ')} })`
}