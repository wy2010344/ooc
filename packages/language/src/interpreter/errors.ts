/**
 * OOC 最终无法处理消息时抛出的错误。
 *
 * 用户可以在对象中定义 methodNotFound 自行处理未知消息；只有策略链、内置消息和
 * methodNotFound 都无法处理时，运行时才会抛出这个结构化错误。
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
