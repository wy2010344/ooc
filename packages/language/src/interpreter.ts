import { AstNode, LangiumDocument, URI } from 'langium'
import { DefaultSharedModuleContext } from 'langium/lsp'
import { parseHelper } from 'langium/test'
import {
  Expression,
  Method,
  Model,
  Primary,
  Message,
  StID,
  createObjectOrientedCServices,
  MethodFunName,
  MethodProperty,
} from 'object-oriented-c-language'
import path from 'path'
import { KVPair, run } from 'wy-helper'
// 定义值类型
export type Value = number | string | boolean | null | ObjectValue

export class ObjectValue {
  constructor(
    readonly methods: Method[],
    readonly scope: Scope,
  ) {
    this.cache = new Map()
    methods.forEach((method) => {
      if (method.$type == 'MethodBind') {
        this.cache.set(
          method.name,
          interpretExpression(method.expression, this.scope),
        )
      }
    })
  }
  private cache: Map<string, any>

  send(name: string, args: any[]) {
    const method = this.methods.find((v) => v.name == name)
    if (!method) {
      throw new Error(`没有定义该方法${name}`)
    }
    switch (method.$type) {
      case 'MethodBind':
        return this.cache.get(method.name)
      case 'MethodAll':
        let s = addScope(this.scope, 'this', this)
        s = addScope(s, 'args', args)
        s = addScope(s, 'methodName', name)
        method.params.forEach((param, index) => {
          s = addScope(s, param.name, args[index])
        })
        let last = null
        method.expressions.forEach((e) => {
          switch (e.$type) {
            case 'Assignment':
              s = addScope(s, e.name, interpretExpression(e.expression, s))
              return
            default:
              last = interpretExpression(e, s)
              return
          }
        })
        return last
    }
  }
}

async function interpret(
  model: Model,
  scope: Scope,
  rootPath: string,
  interpretAction: InterpretAction,
) {
  // 收集导入语句
  const imports = model.expressions.filter((x) => x.$type == 'ImportStatement')
  // 处理导入（支持动态加载模块）
  const out = await Promise.all(
    imports.map((importStmt) =>
      interpretAction(path.join(rootPath, '../', importStmt.path)),
    ),
  )
  let last: any = null
  let importIndex = 0
  model.expressions.forEach((e) => {
    switch (e.$type) {
      case 'Assignment':
        scope = addScope(
          scope,
          e.name,
          interpretExpression(e.expression, scope),
        )
        return
      case 'ImportStatement':
        const value = out[importIndex]
        scope = addScope(scope, e.name, value)
        importIndex++
        return
      default:
        last = interpretExpression(e, scope)
        return
    }
  })
  return last
}

function interpretExpression(e: Expression, scope: Scope): any {
  switch (e.$type) {
    case 'MessageOrChain':
      const o = interpretPrimary(e.primary, scope)
      if (e.message) {
        return sendMessageWith(o, e.message, scope)
      }
      return o
    default:
      const obj = interpretExpression(e.left, scope)
      const r = e.right
      switch (r.$type) {
        case 'Message':
          return sendMessageWith(obj, r, scope)
        case 'MessageChain':
          const args = r.message.args.map((arg) => interpretPrimary(arg, scope))
          args.unshift(obj)
          const main = interpretPrimary(r.primary, scope)
          return sendMessage(main, r.message.name, args)
        default:
          scope = addScope(scope, r.param, obj)
          const re = r.expression
          switch (re.$type) {
            case 'MessageChain':
              const o = interpretPrimary(re.primary, scope)
              return sendMessageWith(o, re.message, scope)
            default:
              return interpretPrimary(re, scope)
          }
      }
  }
}

function sendMessageWith(o: any, message: Message, scope: Scope) {
  const name = message.name
  const args = message.args.map((arg) => interpretPrimary(arg, scope))
  return sendMessage(o, name, args)
}

const boolBuildIn = {
  and: function (a: boolean, b: boolean) {
    return a && b
  },
  or: function (a: boolean, b: boolean) {
    return a || b
  },
  not: function (a: boolean) {
    return !a
  },
}
const numberBuildIn = {
  // 数值方法
  add: function (a: number, b: number) {
    return a + b
  },
  sub: function (a: number, b: number) {
    return a - b
  },
  mul: function (a: number, b: number) {
    return a * b
  },
  div: function (a: number, b: number) {
    return a / b
  },
  mod: function (a: number, b: number) {
    return a % b
  },
  concat: function (a: string, b: string) {
    return a + b
  },
  // 比较操作
  eq: function (a: any, b: any) {
    return a === b
  },
  neq: function (a: any, b: any) {
    return a !== b
  },
  lt: function (a: any, b: any) {
    return a < b
  },
  gt: function (a: any, b: any) {
    return a > b
  },
  lte: function (a: any, b: any) {
    return a <= b
  },
  gte: function (a: any, b: any) {
    return a >= b
  },
}

function sendMessage(
  o: any,
  name: MethodFunName | MethodProperty,
  args: any[],
) {
  let value = name.value
  if (name.$type == 'MethodProperty') {
    value = value.slice(1)
  }
  if (o instanceof ObjectValue) {
    if (name.$type == 'MethodProperty') {
      console.log('自定义对象不需要property')
    }
    return o.send(value, args)
  }
  const tp = typeof o

  switch (name.$type) {
    case 'MethodFunName':
      if (tp == 'number') {
        //数字类型扩展方法
        const fun = numberBuildIn[value as 'add'] as any
        if (fun) {
          return fun(o, ...args)
        }
      }
      if (tp == 'boolean') {
        //布尔类型扩展方法
        const fun = boolBuildIn[value as 'and'] as any
        if (fun) {
          return fun(o, ...args)
        }
      }
      //普通js对象
      return o[value].apply(o, args)
    default:
      if (args.length) {
        o[value] = args[0]
      }
      return o[value]
  }
}

function getStId(e: StID) {
  const n = e as StID & {
    xvalue: string
  }
  if (!n.xvalue) {
    n.xvalue = n.value.slice(1)
  }
  return n.xvalue
}

function interpretPrimary(e: Primary, scope: Scope) {
  switch (e.$type) {
    case 'Bool':
      return e.value == 'true'
    case 'Nil':
      return null
    case 'Num':
      return e.value
    case 'Ref':
      return getScope(scope, e.value)
    case 'ObjectDef':
      return new ObjectValue(e.methods, scope)
    case 'StID':
      return getStId(e)
    case 'Str':
      console.log('str', e.value)
      return e.value
    default:
      return interpretExpression(e, scope)
  }
}

interface RootScope {
  get(key: string): any
}

type Scope = KVPair<any> | undefined

function addScope(scope: Scope, key: string, value: any) {
  return new KVPair(key, value, scope)
}
function getScope(scope: Scope, key: string) {
  if (scope) {
    const kv = scope.get(key)
    if (kv) {
      return kv.value
    }
  }
  return globalRoot.get(key)
}
const extendGlobalObject = {
  JSAttr: {
    get(obj: any, name: string) {
      return obj[name]
    },
    set(obj: any, name: string, value: any) {
      obj[name] = value
      return value
    },
  },
}

const globalRoot: RootScope = {
  get(key: string): any {
    if (key in extendGlobalObject) {
      return extendGlobalObject[key as 'JSAttr']
    }
    if (key in global) {
      return global[key as 'Object']
    }
    throw new Error(`not found define for ${key}`)
  },
}

type InterpretAction = (name: string) => Promise<any>
/**
 * 执行 OOC 模型的入口函数
 */
function executeOOC(
  model: Model,
  path: string,
  interpretAction: InterpretAction,
) {
  return interpret(model, undefined, path, interpretAction)
}

const cacheInterpret = new Map<string, Promise<any>>()
export function createInterpretAction(context: DefaultSharedModuleContext) {
  const services = createObjectOrientedCServices(context).ObjectOrientedC
  const parse = parseHelper(services)
  const fs = context.fileSystemProvider(services.shared)
  function interpretPath(fileName: string) {
    let value = cacheInterpret.get(fileName)
    if (!value) {
      value = run(async () => {
        const extensions = services.LanguageMetaData.fileExtensions
        if (!extensions.includes(path.extname(fileName))) {
          throw `Please choose a file with one of these extensions: ${extensions}.`
        }
        const uri = URI.file(path.resolve(fileName))
        if (!fs.exists(uri)) {
          throw `File ${fileName} does not exist.`
        }
        const document =
          await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
            uri,
          )
        return execDocument(document, fileName)
      })
      cacheInterpret.set(fileName, value)
    }
    return value
  }

  async function execDocument(
    document: LangiumDocument<AstNode>,
    fileName: string,
  ) {
    await services.shared.workspace.DocumentBuilder.build([document], {
      validation: true,
    })

    const validationErrors = (document.diagnostics ?? []).filter(
      (e) => e.severity === 1,
    )
    if (validationErrors.length > 0) {
      throw (
        'There are validation errors:\n' +
        validationErrors
          .map(
            (validationError) =>
              `line ${validationError.range.start.line + 1}: ${validationError.message} [${document.textDocument.getText(validationError.range)}]`,
          )
          .join('.\n')
      )
    }
    const model = document.parseResult.value as Model
    return executeOOC(model, fileName, interpretPath)
  }

  return {
    interpretPath,
    async interpret(txt: string, fileName = '') {
      const document = await parse(txt)
      return execDocument(document, fileName)
    },
  }
}
