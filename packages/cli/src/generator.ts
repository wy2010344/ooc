import type {
  Model,
  ObjectDef,
  Method,
  MethodAll,
  MethodBind,
  MethodDefName,
  Expression,
  Primary,
  Message,
  MessageChain,
  MessageOrChain,
} from 'object-oriented-c-language'
type OOCModel = Model
import * as fs from 'node:fs'
import * as path from 'node:path'
import { extractDestinationAndName } from './util.js'

function genStatements(
  exps: any[],
  bodyStmts: string[],
): void {
  exps.forEach((e: any) => {
    switch (e.$type) {
      case 'Assignment':
        bodyStmts.push(`let ${e.name} = ${genExpression(e.expression)};`)
        break
      case 'ExceptionCatch':
        bodyStmts.push(
          `try { const __val = ${genExpression(e.expression)}; let ${e.error} = null; let ${e.name} = __val; } catch(__err) { let ${e.error} = __err; let ${e.name} = null; }`,
        )
        break
      default:
        bodyStmts.push(`__last = ${genExpression(e)};`)
        break
    }
  })
}

/** lambda `[x -> body]` 编译成 JS 函数：与解释器语义一致（可被宿主回调直接调用） */
function genLambdaDef(e: any): string {
  const params = (e.params || []).map((p: any) => p.name).join(', ')
  const bodyStmts: string[] = []
  genStatements(e.expressions || [], bodyStmts)
  return `(function(${params}){ let __last = null; ${bodyStmts.join(' ')} return __last; })`
}

function genPrimary(p: Primary): string {
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
    case 'ObjectDef':
      return genObjectDef(p as any)
    case 'LambdaDef':
      return genLambdaDef(p as any)
    case 'StID':
      return JSON.stringify(((p as any).value as string).slice(1))
    default:
      // Fallback: try to treat as expression
      return genExpression(p as any)
  }
}

/** 提取 MethodCallName 的消息名（Ref=ID / StID / Str），与 runtime getMethodCallName 一致 */
function callNameStr(node: any): string {
  const v = node?.value
  if (v?.value == null) return ''
  if (v.$type === 'StID') return v.value.slice(1)
  return v.value
}

function genMessageSend(receiver: string, message: Message): string {
  const nameNode: any = message.name
  const name = callNameStr(nameNode)
  const isProp = nameNode ? nameNode.$type === 'MethodProperty' : false
  const args = (message.args || []).map((a: Primary) => genPrimary(a))
  return `__send(${receiver}, ${JSON.stringify(name)}, [${args.join(',')}], ${isProp})`
}

function genChainSend(left: string, mc: MessageChain, isProp: boolean): string {
  const args = (mc.message.args || []).map((a: Primary) => genPrimary(a))
  // first arg is left
  return `__send(${genPrimary(mc.primary)}, ${JSON.stringify(callNameStr(mc.message.name))}, [${[left, ...args].join(',')}], ${isProp})`
}

function genExpression(e: Expression): string {
  if (!e) return 'undefined'
  if ((e as any).$type === 'MessageOrChain') {
    const mc = e as any as MessageOrChain
    const primary = genPrimary(mc.primary)
    if (mc.message) {
      return genMessageSend(primary, mc.message)
    }
    return primary
  }
  // piped forms
  const left = genExpression((e as any).left)
  const r = (e as any).right
  switch (r.$type) {
    case 'Message':
      return genMessageSend(left, r as Message)
    case 'MessageChain': {
      const mc = r as MessageChain
      return genChainSend(
        left,
        mc,
        (mc.message.name as any).$type === 'MethodProperty',
      )
    }
    case 'MessagePipRight': {
      // `left | obj m args`：obj 是接收者，left 前置为第一实参
      const mc = (r as unknown as { value: MessageChain }).value
      return genChainSend(
        left,
        mc,
        (mc.message.name as any).$type === 'MethodProperty',
      )
    }
    case 'MessageInfixRight': {
      // `left + value`：infix 当作二元消息
      const inf = r as {
        infix: string
        value: Primary
      }
      return `__send(${left}, ${JSON.stringify(inf.infix)}, [${genPrimary(inf.value)}], false)`
    }
    default:
      // NamedExpression: bind left to param then eval inner expr
      // r has param and expression
      const param = (r as any).param
      const inner = genExpression((r as any).expression)
      return `(() => { const ${param} = ${left}; return (${inner}); })()`
  }
}

/** 提取 MethodDefName 的中文消息名（Ref/Str/StID） */
function methodNameStr(m: { name: MethodDefName }): string {
  const raw = (m.name as any).name as { value?: string }
  return raw?.value ?? ''
}

function genMethod(m: Method): string | null {
  if (m.$type === 'MethodBind') {
    const mb = m as MethodBind
    const val = genExpression((mb as any).expression)
    return `{ type: 'bind', name: ${JSON.stringify(methodNameStr(m))}, value: ${val} }`
  }
  const ma = m as MethodAll
  const body = ma.body
  // 签名方法（无函数体）不生成：与解释器「签名不烧录」一致，避免遮蔽同名实现方法
  if (!body) return null
  const params = (ma.params || []).map((p: any) => p.name).join(', ')
  const bodyStmts: string[] = []
  genStatements(body.expressions || [], bodyStmts)
  const fn = `(function(${params}){ let __last = null; ${bodyStmts.join(' ')} return __last; })`
  return `{ type: 'method', name: ${JSON.stringify(methodNameStr(m))}, fn: ${fn} }`
}

function genObjectDef(obj: ObjectDef): string {
  const methods = (obj.methods || [])
    .map((m: Method) => genMethod(m))
    .filter((s: string | null): s is string => s !== null)
    .join(',\n')
  return `__createObject([\n${methods}\n])`
}

export function generateJavaScript(
  model: OOCModel,
  filePath: string,
  destination: string | undefined,
): string {
  const data = extractDestinationAndName(filePath, destination)
  const generatedFilePath = `${path.join(data.destination, data.name)}.js`

  const header =
    `"use strict";\n// Generated from OOC model\n` +
    `\n` +
    `const __numberBuildIn = { '+':(a,b)=>a+b, '-':(a,b)=>a-b, '*':(a,b)=>a*b, div:(a,b)=>a/b, '%':(a,b)=>a%b, '>':(a,b)=>a>b, '<':(a,b)=>a<b, '>=':(a,b)=>a>=b, '<=':(a,b)=>a<=b };\n` +
    `const __boolBuildIn = { '&&':(a,b)=>a&&b, '||':(a,b)=>a||b };\n` +
    `const __objectBuildIn = { '==':(a,b)=>a==b, '!=':(a,b)=>a!=b, '&&':(a,b)=>a&&b, '||':(a,b)=>a||b, '!!':(a)=>Boolean(a), '~!':(a)=>!Boolean(a), not:(a)=>!Boolean(a), include:(a,v)=>((typeof a==='function')?(v instanceof a):((a&&typeof a.includes==='function')?a.includes(v):((a&&typeof a.has==='function')?a.has(v):a===v))) };\n\n` +
    `function __createObject(methods){\n  const store = { methods };\n  const proxy = new Proxy({}, {\n    get(_, prop){\n      if (prop === '__methods') return methods;\n      const m = methods.find(x=>x.name===prop);\n      if (!m) return undefined;\n      if (m.type === 'bind') return m.value;\n      return function(...args){\n        // call method function with args; provide this as proxy for closures if needed\n        return m.fn.apply(proxy, args);\n      }\n    }\n  });\n  return proxy;\n}\n\nfunction __send(o, name, args, isProp){\n  if (typeof o === 'function' && name === 'apply') { return o(...args); }\n  if (o && o.__methods) {\n    const m = o.__methods.find(x=>x.name===name);\n    if (!m) throw new Error('method not found:'+name);\n    if (m.type === 'bind') return m.value;\n    return m.fn.apply(o, args);\n  }\n  const tp = typeof o;\n  if (!isProp) {\n    if (tp === 'number') { const f = __numberBuildIn[name]; if (f) return f(o, ...args); }\n    if (o && typeof o[name] === 'function') return o[name](...args);\n    if (o && name in o) return o[name];\n    const f = __objectBuildIn[name]; if (f) return f(o, ...args);\n    return undefined;\n  } else {\n    if (args.length) o[name] = args[0]; return o[name];\n  }\n}\n\n`

  // generate body from model
  const bodyLines: string[] = []
  model.expressions.forEach((stmt: any) => {
    switch (stmt.$type) {
      case 'Assignment':
        bodyLines.push(`let ${stmt.name} = ${genExpression(stmt.expression)};`)
        break
      case 'ImportStatement':
        // keep imports as require of generated file path at runtime
        bodyLines.push(
          `// import ${stmt.name} from ${JSON.stringify(stmt.path)}`,
        )
        break
      case 'ExceptionCatch':
        bodyLines.push(
          `try { const __val = ${genExpression(stmt.expression)}; let ${stmt.error} = null; let ${stmt.name} = __val; } catch(__err) { let ${stmt.error} = __err; let ${stmt.name} = null; }`,
        )
        break
      default:
        bodyLines.push(`// expression => ${genExpression(stmt)}`)
        break
    }
  })

  const fileContent = header + '\n' + bodyLines.join('\n') + '\n'

  if (!fs.existsSync(data.destination)) {
    fs.mkdirSync(data.destination, { recursive: true })
  }
  fs.writeFileSync(generatedFilePath, fileContent)
  return generatedFilePath
}
