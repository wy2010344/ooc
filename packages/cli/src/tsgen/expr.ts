// 表达式 → TS 代码生成。语义复刻解释器 evaluate.ts：MessageOrChain 求值 primary + 发消息，
// PiplingExpression 按 right 类型分派（级联 '/'、管道 '|'、中缀）。所有消息统一走 __send。
import type { Expression, Message, Primary } from 'object-oriented-c-language'
import { isTypeRef } from './util.js'
import { literalOfBindBody, type PrimitiveLiteral } from 'object-oriented-c-language'

/** 纯字面量 → TS 代码（绑定数据属性值） */
function literalCode(lit: PrimitiveLiteral): string {
  switch (lit.kind) {
    case 'str':
      return JSON.stringify(lit.value)
    case 'num':
      return String(lit.value)
    case 'bool':
      return lit.value ? 'true' : 'false'
    case 'nil':
      return 'null'
  }
}

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

function argCode(a: any): string {
  const value = primaryCode(a.value)
  // 展开参数：`...expr` 求值为数组则摊平，否则整体作单参（与解释器语义一致）
  return a.spread ? `...__spread(${value})` : value
}

function argsCode(m: Message): string {
  return (m.args || []).map((a: any) => argCode(a)).join(', ')
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
      const chainArgs = [left, ...(mc.message.args || []).map((a: any) => argCode(a))]
      return `__send(${primaryCode(mc.primary)}, ${JSON.stringify(messageName(mc.message))}, [${chainArgs.join(', ')}])`
    }
    case 'MessageInfixRight':
      return `__send(${left}, ${JSON.stringify(r.infix)}, [${primaryCode(r.value)}])`
    default:
      return left
  }
}

function paramList(node: { params: Array<{ name: string; typeAnnotation?: unknown }>; restParam?: { name: string } }): string {
  const params = (node.params || []).map((p) => `${p.name}${typeAnnot(p.typeAnnotation) || ': any'}`)
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
  // 字面量/内建类型名节点（Str/Bool/Num/Nil/ID/Ref）：转成对应 TS 类型
  const n = tn.name
  if (n && typeof n.$type === 'string') {
    switch (n.$type) {
      case 'Str':
        return JSON.stringify(n.value)
      case 'Bool':
        return 'boolean'
      case 'Num':
        return 'number'
      case 'Nil':
        return 'nil'
      default:
        return n.value
    }
  }
  const name = n
  const args = (tn.typeArgs || []).map((a: any) => typeCode(a)).join(', ')
  // `ns#Name` 命名空间类型：值侧是默认导入（模块对象），不能当类型命名空间用。
  // esm 头部按 ns 用点补发 `import * as ns$ns from '<同一模块>'`（OOC 标识符不含
  // `$`，别名必不与用户绑定相撞），这里引用 `ns$ns.Name`。
  const qualified = typeof tn.ns === 'string' && tn.ns ? `${tn.ns}$ns.` : ''
  return `${qualified}${name}${args ? `<${args}>` : ''}`
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
    // 绑定：纯字面量 → 数据属性值（构造期求值一次）；计算式 → thunk（首次求值并
    // 缓存，getter）。计算式可为单表达式或 @{ 多条语句 } 块。
    case 'MethodBind': {
      const lit = literalOfBindBody(m.bindBody)
      if (lit) {
        return `{ type: 'value', name: ${JSON.stringify(name)}, value: ${literalCode(lit)} }`
      }
      const body = m.bindBody
      const fn =
        body && body.$type === 'BindBlock'
          ? `function(){ ${bodyCode(body.bindStmts ?? [])} }`
          : `function(){ return ${expressionCode(body.expression)} }`
      return `{ type: 'bind', name: ${JSON.stringify(name)}, fn: ${fn} }`
    }
    // 转发属性 <=：__mutable(getDelegate) 惰性求值委托对象一次并缓存，之后本 key
    // 上的一切消息原样转发给委托对象的 apply（消息名不传，只传实参）。
    case 'MethodBindMutable': {
      const body = m.bindBody
      const delegate =
        body && body.$type === 'BindBlock'
          ? `function(){ ${bodyCode(body.bindStmts ?? [])} }`
          : `function(){ return ${expressionCode(body.expression)} }`
      return `{ type: 'mutable', name: ${JSON.stringify(name)}, fn: __mutable(${delegate}) }`
    }
    default: {
      const body = m.body
      // 签名方法（无函数体）不烧录，与解释器一致
      if (!body) return null
      // #guard 分支链（preBranch 是 else 兜底，guardBranches 顺序判别）编译成
      // if / else if / else 链，命中块执行完即 return
      const guards = body.guardBranches ?? []
      const fn =
        guards.length > 0
          ? `function(${paramList(m)}){ ${guardedBodyCode(body)} }`
          : `function(${paramList(m)}){ ${bodyCode(body.stmts ?? [])} }`
      // 零参/带参统一为方法函数（数据函数 + 运行时打 OOC_METHOD 标记）
      return `{ type: 'call', name: ${JSON.stringify(name)}, fn: ${fn} }`
    }
  }
}

function methodName(n: any): string {
  const raw = n?.name
  if (!raw) return ''
  if (raw.$type === 'StID') return raw.value.slice(1)
  return raw.value ?? ''
}

/**
 * 块 → JS：复刻解释器 runBody 的 addScope 语义——「先用外层作用域求值 RHS，再遮蔽绑定」。
 * JS 的 let/var 提升是词法的，`let x = <引用 x 的 RHS>` 必 TDZ，所以逐层套块：
 *   { const __v1 = <RHS1>; { const x = __v1; ... } }
 * RHS 在 x 尚未声明的块里求值，自然引用外层同名值。
 */
function bodyCode(stmts: any[]): string {
  if (stmts.length === 0) {
    return 'let __last = null; return __last;'
  }
  // 自内向外逐层包裹：最内层是最后一条语句（块的值）
  let inner = `__last = ${expressionCode(stmts[stmts.length - 1] as any)}; return __last;`
  for (let i = stmts.length - 2; i >= 0; i--) {
    const st = stmts[i]
    if (st.$type === 'Assignment') {
      inner = `{ const __v${i} = ${expressionCode(st.expression)}; { const ${st.name} = __v${i}; ${inner} } }`
    } else {
      inner = `{ __last = ${expressionCode(st as any)}; ${inner} }`
    }
  }
  return `let __last = null; ${inner}`
}

/**
 * #guard 分支链 → 前置语句先执行（与解释器 runGuardedBody 一致：
 * 赋值进作用域，表达式求值），再 if / else if / else：命中即 return 该分支语句段的值。
 * 复刻 bodyCode 的逐层嵌套遮蔽语义，但不 return，执行完进入 guard 链。
 */
function guardedBodyCode(body: any): string {
  const chain = guardChainCode(body)
  const pre = body.stmts ?? []
  if (pre.length === 0) {
    return chain
  }
  let inner = chain
  for (let i = pre.length - 1; i >= 0; i--) {
    const st = pre[i]
    if (st.$type === 'Assignment') {
      inner = `{ const __v${i} = ${expressionCode(st.expression)}; { const ${st.name} = __v${i}; ${inner} } }`
    } else {
      inner = `{ __last = ${expressionCode(st)}; ${inner} }`
    }
  }
  return `let __last = null; ${inner}`
}

/** if / else if / else 链本体：命中即 return，无 else 时返回 nil。 */
function guardChainCode(body: any): string {
  const parts: string[] = []
  const branches = body.guardBranches ?? []
  branches.forEach((branch: any, i: number) => {
    const kw = i === 0 ? 'if' : 'else if'
    const block = bodyCode(branch.stmts ?? [])
    parts.push(`${kw} (${expressionCode(branch.guardExpression)}) { ${block} }`)
  })
  const elseBlock = body.elseBranch
    ? bodyCode(body.elseBranch.stmts ?? [])
    : 'let __last = null; return __last;'
  parts.push(`else { ${elseBlock} }`)
  return parts.join(' ')
}

/** lambda [x => body]：等价 { apply(...) {...} }，编译成真正的 JS 函数（解释器语义：既是值又是函数）。 */
function lambdaDefCode(e: any): string {
  if (!e || e.$type !== 'LambdaDef') return expressionCode(e)
  const params = (e.params || []).map((p: any) => `${p.name}${typeAnnot(p.typeAnnotation) || ': any'}`)
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