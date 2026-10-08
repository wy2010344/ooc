/**
 * OOC 最终无法处理消息时抛出的错误。
 *
 * 语言没有 methodNotFound 兜底：只有内置消息（numDef/objectDefine）和
 * 对象自身方法都无法处理时，运行时才抛这个结构化错误。需要拦截未知消息的
 * 对象，必须用 `js proxy 对象 handler` 显式包成兜底 Proxy，未知消息经 get
 * trap 交给 handler(name, ...args)，不会走到这里。
 */
export class OocMethodNotFoundError extends TypeError {
  readonly receiver: unknown
  readonly methodName: string
  readonly argumentsList: readonly unknown[]

  constructor(receiver: unknown, methodName: string, args: readonly unknown[]) {
    super(`没有定义该方法 ${methodName}`)
    this.name = 'OocMethodNotFoundError'
    this.receiver = receiver
    this.methodName = methodName
    this.argumentsList = args
  }
}

/** 模块导入路径形成环时抛出的错误。 */
export class OocCircularImportError extends Error {
  readonly moduleChain: readonly string[]

  constructor(moduleChain: readonly string[]) {
    super(`不允许循环模块导入：${moduleChain.join(' -> ')}`)
    this.name = 'OocCircularImportError'
    this.moduleChain = moduleChain
  }
}
