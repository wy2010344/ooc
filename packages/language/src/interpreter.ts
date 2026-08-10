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
import { KVPair, run } from 'wy-helper'
import {
  isModel,
  MethodAll,
  Str,
  LambdaDef,
  ImportStatement,
} from './generated/ast.js'
import { objectDefine } from './library/object.js'
import { numDef } from './library/num.js'
import {
  codeOfDiagnostic,
  filterDiagnostic,
  loadOocConfig,
  type OocConfig,
} from './diagnostics-config.js'
import {
  dirnameOf,
  extnameOf,
  joinPath,
  resolveModuleName,
} from './module-path.js'
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

/***
 * 好像并不能和js的原型对象一一匹配，主要是guard的策略，可以路由到父节点去处理。
 */
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
      interpretAction(joinPath(dirnameOf(rootPath), importStmt.path)),
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
              return sendMessage(main, getMethodCallName(rv.message.name), args)
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
  return sendMessage(o, getMethodCallName(name), args)
}

function getMethodCallName({ value }: MethodCallName) {
  switch (value.$type) {
    case 'StID':
      return value.value.slice(1)
    case 'Str':
      return getStrValue(value)
    default:
      return value.value
  }
}
function sendMessage(o: any, value: string, args: any[]): any {
  if (o instanceof ObjectValue) {
    return o.send(value, o, args)
  }
  const fun = o[value]
  if (typeof fun === 'function') {
    //能找到对象方法定义，包括proxy其实也在里面
    return fun.apply(o, args)
  }
  if (value === 'methodNotFound') {
    throw new TypeError(`没有定义该方法${value}`)
  }
  if (value in Object(o)) {
    //属性读取与设置
    if (args.length) {
      o[value] = args[0]
    }
    return o[value]
  }
  const num = numDef[value as '<']
  if (num) {
    return num(o, args[0])
  }
  const obj = objectDefine[value as '||']
  if (obj) {
    return obj(o, args[0])
  }
  return sendMessage(o, 'methodNotFound', [value, ...args])
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
    case 'LambdaDef':
      // lambda 等价于 { apply(...) { ... } }，合成一个 apply 方法
      return createLambdaValue(e, scope)
    case 'StID':
      return getStId(e)
    case 'Str':
      return getStrValue(e)
    default:
      return interpretExpression(e, scope)
  }
}

/**
 * lambda `[x -> body]` 与对象 `{ apply(x) { body } }` 语义相同：
 * 生成一个只包含 apply 方法的 ObjectValue。
 */
function createLambdaValue(e: LambdaDef, scope: Scope): ObjectValue {
  // 合成的 apply 方法节点：运行时只读取 name/params/restParam/guardExpression/expressions，
  // $container 等链接信息由 Langium 在真实解析时填充，此处不需要。
  const applyMethod = {
    $type: 'MethodAll',
    name: {
      $type: 'MethodDefName',
      name: { $type: 'Ref', value: 'apply' },
    },
    params: e.params,
    expressions: e.expressions,
  } as unknown as MethodAll
  return new ObjectValue([applyMethod], scope, undefined)
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

const globalRoot: RootScope = {
  get(key: string): any {
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
  globals: Globals,
) {
  return interpret(
    model,
    withGlobals(undefined, globals),
    path,
    interpretAction,
  )
}

const cacheInterpret = new Map<string, Promise<any>>()
/**
 * 宿主注入的 JS 全局对象（如 storage），OOC 源码直接按名字引用，无需 #import。
 */
export type Globals = Record<string, unknown>
/**
 * 配置来源：显式传入，或 'auto'（从根目录 ooc.json 读取）。
 */
export type ConfigSource = OocConfig | 'auto' | undefined
export function createInterpretAction(
  context: DefaultSharedModuleContext,
  globals: Globals = {},
  config: ConfigSource = 'auto',
) {
  const services = createObjectOrientedCServices(context).ObjectOrientedC
  const parse = parseHelper(services)
  const fs = context.fileSystemProvider(services.shared)
  // ooc.json 配置：按根目录缓存
  let cachedConfig: OocConfig | undefined
  let cachedConfigRoot: string | undefined
  async function resolveConfig(rootPath: string): Promise<OocConfig> {
    if (config && config !== 'auto') {
      return config
    }
    if (cachedConfigRoot === rootPath) {
      return cachedConfig ?? {}
    }
    cachedConfigRoot = rootPath
    cachedConfig = await loadOocConfig(fs, rootPath)
    return cachedConfig ?? {}
  }
  function interpretPath(rawName: string) {
    let value = cacheInterpret.get(rawName)
    if (!value) {
      value = run(async () => {
        const extensions = services.LanguageMetaData.fileExtensions
        // 统一为 posix 路径；无扩展名的虚拟路径补默认扩展（Langium 按扩展名注册语言服务）
        const fileName = resolveModuleName(rawName, '', extensions)
        const ext = extnameOf(fileName)
        if (ext && !extensions.includes(ext)) {
          throw `Please choose a file with one of these extensions: ${extensions}.`
        }
        const uri = URI.file(fileName)
        if (!fs.exists(uri)) {
          throw `File ${fileName} does not exist.`
        }
        const document =
          await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
            uri,
          )
        return execDocument(document, fileName)
      })
      cacheInterpret.set(rawName, value)
    }
    return value
  }

  /**
   * 预加载导入文档树（含递归导入），让静态类型解析器在文档校验期间
   * 能同步取到被导入模块的 AST。路径解析与校验器 createImportResolver 完全一致，
   * 都以 document.uri.path 为基准目录。
   */
  async function preloadImportTree(
    document: LangiumDocument<AstNode>,
    seen = new Set<string>(),
  ): Promise<void> {
    const model = document.parseResult.value
    if (!isModel(model)) {
      return
    }
    const docs = services.shared.workspace.LangiumDocuments
    const extensions = services.LanguageMetaData.fileExtensions
    for (const stmt of model.expressions) {
      if (stmt.$type !== 'ImportStatement') {
        continue
      }
      const importStmt = stmt as ImportStatement
      const fileName = resolveModuleName(
        importStmt.path,
        document.uri.path,
        extensions,
      )
      const ext = extnameOf(fileName)
      if (ext && !extensions.includes(ext)) {
        continue
      }
      if (seen.has(fileName) || !fs.existsSync(URI.file(fileName))) {
        continue
      }
      seen.add(fileName)
      const imported = await docs.getOrCreateDocument(URI.file(fileName))
      await preloadImportTree(imported, seen)
    }
  }

  async function execDocument(
    document: LangiumDocument<AstNode>,
    fileName: string,
  ) {
    await preloadImportTree(document)
    await services.shared.workspace.DocumentBuilder.build([document], {
      validation: true,
    })

    const resolved = await resolveConfig(dirnameOf(fileName))
    const validationErrors = (document.diagnostics ?? []).filter((e) => {
      const next = filterDiagnostic(resolved, e.severity, codeOfDiagnostic(e))
      return next === 1
    })
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
    return executeOOC(model, fileName, interpretPath, globals)
  }

  return {
    interpretPath,
    async interpret(txt: string, fileName = '') {
      // 用真实文件名作为文档 URI，保证 ConfigAwareDocumentValidator 能
      // 按文件目录找到最近的 ooc.json（否则默认 URI 下找不到，默认 off
      // 的规则如 noImplicitAny 会被提前丢弃）。
      const document = await parse(txt, {
        documentUri: fileName
          ? URI.file(fileName).toString()
          : undefined,
      })
      return execDocument(document, fileName)
    },
  }
}

/**
 * 注入的全局对象作为最外层作用域：getScope 优先在作用域链里命中，
 * 找不到再回退到 globalRoot。
 */
function withGlobals(scope: Scope, globals: Globals): Scope {
  let s = scope
  for (const key of Object.keys(globals)) {
    s = addScope(s, key, globals[key])
  }
  return s
}
