import type {
  Model,
  ObjectDef,
  Method,
  MethodAll,
  MethodBind,
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
    case 'StID':
      return JSON.stringify(((p as any).value as string).slice(1))
    default:
      // Fallback: try to treat as expression
      return genExpression(p as any)
  }
}

function genMessageSend(receiver: string, message: Message): string {
  const nameNode: any = message.name
  const name = nameNode.value
  const isProp = nameNode.$type === 'MethodProperty'
  const args = (message.args || []).map((a: Primary) => genPrimary(a))
  return `__send(${receiver}, ${JSON.stringify(name)}, [${args.join(',')}], ${isProp})`
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
      const args = (mc.message.args || []).map((a: Primary) => genPrimary(a))
      // first arg is left
      return `__send(${genPrimary(mc.primary)}, ${JSON.stringify((mc.message.name as any).value)}, [${[left, ...args].join(',')}], ${(mc.message.name as any).$type === 'MethodProperty'})`
    }
    default:
      // NamedExpression: bind left to param then eval inner expr
      // r has param and expression
      const param = (r as any).param
      const inner = genExpression((r as any).expression)
      return `(() => { const ${param} = ${left}; return (${inner}); })()`
  }
}

function genMethod(m: Method): string {
  if (m.$type === 'MethodBind') {
    const mb = m as MethodBind
    const val = genExpression((mb as any).expression)
    return `{ type: 'bind', name: ${JSON.stringify(m.name)}, value: ${val} }`
  }
  const ma = m as MethodAll
  const params = (ma.params || []).map((p: any) => p.name).join(', ')
  const bodyStmts: string[] = []
  const exps = ma.expressions || []
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
  const fn = `(function(${params}){ let __last = null; ${bodyStmts.join(' ')} return __last; })`
  return `{ type: 'method', name: ${JSON.stringify(m.name)}, fn: ${fn} }`
}

function genObjectDef(obj: ObjectDef): string {
  const methods = (obj.methods || [])
    .map((m: Method) => genMethod(m))
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
    `const __numberBuildIn = { add:(a,b)=>a+b, sub:(a,b)=>a-b, mul:(a,b)=>a*b, div:(a,b)=>a/b, mod:(a,b)=>a%b, concat:(a,b)=>String(a)+String(b), eq:(a,b)=>a===b, neq:(a,b)=>a!==b, lt:(a,b)=>a<b, gt:(a,b)=>a>b, lte:(a,b)=>a<=b, gte:(a,b)=>a>=b };\n` +
    `const __boolBuildIn = { and:(a,b)=>a&&b, or:(a,b)=>a||b, not:(a)=>!a };\n\n` +
    `function __createObject(methods){\n  const store = { methods };\n  const proxy = new Proxy({}, {\n    get(_, prop){\n      if (prop === '__methods') return methods;\n      const m = methods.find(x=>x.name===prop);\n      if (!m) return undefined;\n      if (m.type === 'bind') return m.value;\n      return function(...args){\n        // call method function with args; provide this as proxy for closures if needed\n        return m.fn.apply(proxy, args);\n      }\n    }\n  });\n  return proxy;\n}\n\nfunction __send(o, name, args, isProp){\n  if (o && o.__methods) {\n    const m = o.__methods.find(x=>x.name===name);\n    if (!m) throw new Error('method not found:'+name);\n    if (m.type === 'bind') return m.value;\n    return m.fn.apply(o, args);\n  }\n  const tp = typeof o;\n  if (!isProp) {\n    if (tp === 'number') { const f = __numberBuildIn[name]; if (f) return f(o, ...args); }\n    if (tp === 'boolean') { const f = __boolBuildIn[name]; if (f) return f(o, ...args); }\n    if (o && typeof o[name] === 'function') return o[name](...args);\n    if (o && name in o) return o[name];\n    return undefined;\n  } else {\n    if (args.length) o[name] = args[0]; return o[name];\n  }\n}\n\n`

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
