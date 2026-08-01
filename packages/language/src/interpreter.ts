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
  MethodDefName,
  MethodCallName,
} from 'object-oriented-c-language'
import path from 'path'
import { KVPair, run } from 'wy-helper'
import { MethodAll, Str } from './generated/ast.js'
import { objectDefine } from './library/object.js'
import { numDef } from './library/num.js'
// 定义值类型
export type Value = number | string | boolean | null | ObjectValue

type ObjectMethod =
  | {
      type: 'call'
      name: string
      value: MethodAll
    }
  | {
      name: string
      type: 'bind'
      value: any
    }
function getObjDefineName(n: MethodDefName) {
  const v = n.name
  switch (v.$type) {
    case 'Ref':
      return v.value
    case 'StID':
      return v.value.slice(1)
    case 'Str':
      return getStrValue(v)
  }
}
export class ObjectValue {
  readonly methods: ObjectMethod[]
  private scope: Scope
  constructor(
    methods: Method[],
    scope: Scope,
    readonly parent: ObjectValue | undefined,
  ) {
    if (parent != undefined && !(parent instanceof ObjectValue)) {
      throw new Error(`parent 应该是一个ObjectValue`)
    }
    this.methods = Array(methods.length)
    this.scope = addScope(scope, 'currentObject', this)
    methods.forEach((method, i) => {
      switch (method.$type) {
        case 'MethodBind':
          return (this.methods[i] = {
            type: 'bind',
            name: getObjDefineName(method.name),
            value: interpretExpression(method.expression, this.scope),
          })
        default:
          return (this.methods[i] = {
            type: 'call',
            name: getObjDefineName(method.name),
            value: method,
          })
      }
    })
  }
  send(name: string, responser: any, args: any[]): any {
    for (let i = 0; i < this.methods.length; i++) {
      const pair = this.methods[i]
      if (pair.name == name) {
        switch (pair.type) {
          case 'bind':
            return pair.value
          case 'call':
            const method = pair.value
            let s = addScope(this.scope, 'this', this)
            s = addScope(s, 'responser', responser)
            method.params.forEach((param, index) => {
              s = addScope(s, param.name, args[index])
            })

            if (method.restParam) {
              s = addScope(
                s,
                method.restParam.name,
                args.slice(method.params.length),
              )
            }
            if (
              !method.guardExpression ||
              (method.guardExpression &&
                interpretExpression(method.guardExpression, s))
            ) {
              //继续
              let last = null
              method.expressions.forEach((e) => {
                switch (e.$type) {
                  case 'Assignment':
                    s = addScope(
                      s,
                      e.name,
                      interpretExpression(e.expression, s),
                    )
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
    }
    //继承：自身没有，向上查找父对象
    if (this.parent) {
      return this.parent.send(name, responser, args)
    }
    //通用对象方法
    const fun = objectDefine[name as '&&']
    if (fun) {
      return fun(this, args[0])
    }
    if (name == 'methodNotFound') {
      throw new TypeError(`没有定义该方法${name}`)
    }
    return sendMessage(responser, 'methodNotFound', [name, ...args])
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
      case 'TypeDef':
        //类型声明只是装饰，运行时无副作用
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
        case 'MessageChainExt':
          return sendMessageWith(obj, r.value, scope)
        case 'MessagePipRight':
          const rv = r.value
          switch (rv.$type) {
            case 'MessageChain':
              const args = rv.message.args.map((arg) =>
                interpretPrimary(arg, scope),
              )
              args.unshift(obj)
              const main = interpretPrimary(rv.primary, scope)
              return sendMessage(
                main,
                getMethodCallName(rv.message.name),
                args,
                rv.message.name.value.$type == 'ProId',
              )
            default:
              scope = addScope(scope, rv.param, obj)
              return interpretExpression(rv.expression, scope)
            }
        default:
          return sendMessage(obj, r.infix, [interpretPrimary(r.value, scope)])
      }
  }
}

function sendMessageWith(o: any, message: Message, scope: Scope) {
  const name = message.name
  const args = message.args.map((arg) => interpretPrimary(arg, scope))
  return sendMessage(
    o,
    getMethodCallName(name),
    args,
    name.value.$type == 'ProId',
  )
}

function getMethodCallName({ value }: MethodCallName) {
  switch (value.$type) {
    case 'ProId':
      return value.value.slice(1)
    case 'StID':
      return value.value.slice(1)
    case 'Str':
      return getStrValue(value)
    default:
      return value.value
  }
}
function sendMessage(
  o: any,
  value: string,
  args: any[],
  isProd?: boolean,
): any {
  if (o instanceof ObjectValue) {
    if (isProd) {
      console.log('自定义对象不需要property')
    }
    return o.send(value, o, args)
  }
  if (isProd) {
    //属性值读取与设置
    if (args.length) {
      o[value] = args[0]
    }
    return o[value]
  }

  const fun = o[value]
  if (fun) {
    if (typeof fun !== 'function') {
      throw new TypeError(
        `'${value}' 是 ${o.constructor?.name ?? '对象'} 上的属性，不是方法。属性请用 @${value} 访问`,
      )
    }
    //能找到对象方法定义，包括proxy其实也在里面
    return fun.apply(o, args)
  }
  const num = numDef[value as '<']
  if (num) {
    return num(o, args[0])
  }
  const obj = objectDefine[value as '||']
  if (obj) {
    return obj(o, args[0])
  }
  throw new TypeError(`未找到方法${value}`)
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

function getStrValue(e: Str) {
  // console.log('str', e.value)
  return e.value
}

function interpretPrimary(e: Primary, scope: Scope): any {
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
      return new ObjectValue(
        e.methods,
        scope,
        e.extends ? interpretPrimary(e.extends, scope) : undefined,
      )
    case 'StID':
      return getStId(e)
    case 'Str':
      return getStrValue(e)
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
