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
    case 'Str': {
      // 含洞的模版字符串 → [文本/洞…].join('')：文本段是已还原转义的字符串字面量，
      // 洞段是表达式（join 负责字符串化，nil/undefined → 空串）。纯字符串走原样字面量。
      const parts = ((p as any).parts ?? []) as any[]
      if (parts.length > 0) {
        const segs = parts.map((part) =>
          part.$type === 'TemplateHole'
            ? `(${expressionCode(part.expression)})`
            : JSON.stringify(part.value),
        )
        return `[${segs.join(', ')}].join('')`
      }
      return JSON.stringify((p as any).value)
    }
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
  // `$` 直接调用：成员名就是 `$`
  if (v?.$type === 'Dollar') return '$'
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
      // 类型断言是纯静态的：按 OOC 写的类型发射 as T，让 tsc 参与检查；
      // 不做任何运行时转换（尤其不能包 async，否则值会变成 Promise）
      return `(${expressionCode((e as any).expression)} as ${typeCode((e as any).type)})`
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
    throw new Error(`[tsgen] 未知表达式形态：${e.$type}`)
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
    case 'MessageInfixRight': {
      // 中缀：中缀符本身就是成员名（`$` 可带 0~N 个实参，其余恰好 1 个）
      const args =
        r.infix === '$'
          ? (r.args ?? []).map((a: any) => argCode(a))
          : [primaryCode(r.value)]
      return `__send(${left}, ${JSON.stringify(r.infix)}, [${args.join(', ')}])`
    }
    default:
      throw new Error(`[tsgen] 未知级联/管道形态：${r.$type}`)
  }
}

function paramList(node: { params: Array<{ name: string; typeAnnotation?: unknown }>; restParam?: { name: string; typeAnnotation?: unknown } }): string {
  // 所有生成的函数都显式声明 this：OOC 的 this 是动态接收者（方法＝对象，
  // lambda＝lambda 自身），这样 strict/noImplicitThis 下也不会报隐式 any。
  const params = ['this: any']
  for (const p of node.params || []) {
    params.push(`${p.name}${typeAnnot(p.typeAnnotation) || ': any'}`)
  }
  if (node.restParam) {
    params.push(`...${node.restParam.name}${restTypeAnnot(node.restParam.typeAnnotation)}`)
  }
  return params.join(', ')
}

/** 类型标注 → `: T` 片段；无标注返回空串。 */
export function typeAnnot(t?: unknown): string {
  if (!t || !isTypeRef(t)) return ''
  return `: ${typeCode(t)}`
}

/** rest 参数类型：OOC 写 `...xs: number`，TS 需要 `...xs: number[]`。 */
export function restTypeAnnot(t?: unknown): string {
  if (!t || !isTypeRef(t)) return ': any[]'
  const code = typeCode(t)
  if (/\[\]$/.test(code) || /^Array</.test(code)) return `: ${code}`
  const needsParens = code.includes('|') || code.includes('&')
  return `: ${needsParens ? `(${code})[]` : `${code}[]`}`
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
        // OOC 的 nil 类型在 TS 里就是 null（没有全局 nil 类型）
        return 'null'
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

/**
 * 对象定义：全部成员直接生成冻结对象字面量，省掉运行时 entries 数组与
 * defineProperty 循环。计算绑定写成对象字面量 getter，并用 IIFE 闭包缓存
 * 首次求值结果；`<=` 转发是「惰性求值委托 + 函数」，可和普通方法一样直接写入。
 * Object.freeze 保持解释器的「成员只读」语义（字面量＝非 writable 数据属性）。
 */
export function objectDefCode(obj: any): string {
  const all: ObjectEntry[] = (obj.methods || [])
    .map((m: any) => methodCode(m))
    .filter((e: ObjectEntry | null): e is ObjectEntry => e !== null)
  if (all.length === 0) return '{}'
  // 同名成员取首个定义（唯一性由校验器保证）
  const seen = new Set<string>()
  const entries = all.filter((e) => {
    if (seen.has(e.name)) return false
    seen.add(e.name)
    return true
  })
  const decls: string[] = []
  const props: string[] = []
  let getterIndex = 0
  for (const e of entries) {
    if (!('get' in e)) {
      props.push(`${propertyKey(e.name)}: ${e.value}`)
      continue
    }
    // getter 的缓存变量用 `$` 避开 OOC 合法标识符，IIFE 内不会遮蔽用户绑定
    const done = `__ooc$d${getterIndex}`
    const cached = `__ooc$v${getterIndex}`
    getterIndex++
    decls.push(`let ${done} = false, ${cached}: any;`)
    props.push(
      `get ${propertyKey(e.name)}() { if (!${done}) { ${done} = true; ${cached} = (${e.get}).call(this) } return ${cached} }`,
    )
  }
  const literal = `(Object.freeze({ ${props.join(', ')} }) as any)`
  return decls.length > 0 ? `(() => { ${decls.join(' ')} return ${literal} })()` : literal
}

type ObjectEntry =
  /** 数据属性值（字面量/方法/转发函数） */
  | { name: string; value: string }
  /** 计算绑定：惰性求值一次并缓存，编译成对象字面量 getter */
  | { name: string; get: string }

/** `__proto__` 在对象字面量里会改原型，必须用计算键强制成自有属性。 */
function propertyKey(name: string): string {
  const quoted = JSON.stringify(name)
  return name === '__proto__' ? `[${quoted}]` : quoted
}

function methodCode(m: any): ObjectEntry | null {
  const name = methodName(m.name)
  switch (m.$type) {
    // 绑定：纯字面量 → 数据属性值（构造期求值一次）；计算式 → getter（首次求值并
    // 缓存）。计算式可为单表达式或 @{ 多条语句 } 块。
    case 'MethodBind': {
      const lit = literalOfBindBody(m.bindBody)
      if (lit) return { name, value: literalCode(lit) }
      const body = m.bindBody
      const fn =
        body && body.$type === 'BindBlock'
          ? `function(this: any){ ${bodyCode(body.bindStmts ?? [])} }`
          : `function(this: any){ return ${expressionCode(body.expression)} }`
      return { name, get: fn }
    }
    // 转发属性 <=：__mutable(getDelegate) 惰性求值委托对象一次并缓存，之后本 key
    // 上的一切消息原样转发给委托对象的 $（消息名不传，只传实参）。
    case 'MethodBindMutable': {
      const body = m.bindBody
      const delegate =
        body && body.$type === 'BindBlock'
          ? `function(this: any){ ${bodyCode(body.bindStmts ?? [])} }`
          : `function(this: any){ return ${expressionCode(body.expression)} }`
      return { name, value: `__mutable(${delegate})` }
    }
    default: {
      const body = m.body
      // 签名方法（无函数体）不烧录，与解释器一致
      if (!body) return null
      // #guard 分支链（preBranch 是 else 兜底，guardBranches 顺序判别）编译成
      // if / else if / else 链，命中块执行完即 return
      const guards = body.guardBranches ?? []
      // 保留泛型参数与返回类型，strict tsc 才能沿调用链检查
      const typeParams = (m.typeParams ?? []).map((p: any) => p.name).join(', ')
      const signature = `function${typeParams ? `<${typeParams}>` : ''}(${paramList(m)})${typeAnnot(m.returnType)}`
      const fn =
        guards.length > 0
          ? `${signature}{ ${guardedBodyCode(body)} }`
          : `${signature}{ ${bodyCode(body.stmts ?? [])} }`
      // 零参/带参统一为只读数据函数（方法）；形态由 descriptor 承载，不打标记
      return { name, value: fn }
    }
  }
}

function methodName(n: any): string {
  const raw = n?.name
  if (!raw) return ''
  if (raw.$type === 'StID') return raw.value.slice(1)
  // 定义键写 `$`：成员名就是 `$`（编译产物同字面）
  if (raw.$type === 'Dollar') return '$'
  return raw.value ?? ''
}

/**
 * 块 → JS 语句序列。绑定一律 const，平铺输出即与 JS 块级作用域一致。
 * `x = x + 1` 这类自引用声明由 validator 判非法，这里不再做 `__v` 遮蔽兼容。
 * 尾语句是赋值时返回 null，与解释器 `execDocument` 的“语句值”一致。
 */
function bodyCode(stmts: any[], returnLast = true): string {
  if (stmts.length === 0) return returnLast ? 'return null' : ''
  const [st, ...rest] = stmts
  const restCode = bodyCode(rest, returnLast)
  if (st.$type === 'Assignment') {
    const decl = `const ${st.name} = ${expressionCode(st.expression)};`
    const tail = rest.length > 0 ? restCode : returnLast ? 'return null' : ''
    return `${decl} ${tail}`.trim()
  }
  const code = expressionCode(st)
  if (rest.length > 0) return `${code}; ${restCode}`
  return returnLast ? `return ${code}` : `${code};`
}

/**
 * #guard 分支链 → 前置语句先执行（与解释器 runGuardedBody 一致：
 * 赋值进作用域，表达式求值），再 if / else if / else：命中即 return 该分支语句段的值。
 */
function guardedBodyCode(body: any): string {
  const chain = guardChainCode(body)
  const pre = bodyCode(body.stmts ?? [], false)
  return pre ? `${pre} ${chain}` : chain
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
    : 'return null'
  parts.push(`else { ${elseBlock} }`)
  return parts.join(' ')
}

/**
 * lambda [x => body]：编译成真正的 JS 函数（既是值又是函数）。
 * OOC 的 `$` 调用用 `o.apply(o, args)`，所以普通调用时 this 就是 lambda 自身；
 * 显式 `this: any` 只为让 strict tsc 不报隐式 any，不改变运行时语义。
 */
function lambdaDefCode(e: any): string {
  if (!e || e.$type !== 'LambdaDef') return expressionCode(e)
  const params = ['this: any']
  for (const p of e.params || []) {
    params.push(`${p.name}${typeAnnot(p.typeAnnotation) || ': any'}`)
  }
  if (e.restParam) params.push(`...${e.restParam.name}${restTypeAnnot(e.restParam.typeAnnotation)}`)
  return `(function(${params.join(', ')}){ ${bodyCode(e.expressions ?? [])} })`
}