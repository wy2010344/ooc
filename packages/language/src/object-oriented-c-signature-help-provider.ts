import { AstNode, MaybePromise } from 'langium'
import { AbstractSignatureHelpProvider } from 'langium/lsp'
import type { SignatureHelpOptions } from 'vscode-languageserver'
import type { CancellationToken } from 'vscode-jsonrpc'
import type { SignatureHelp } from 'vscode-languageserver'
import type { ParameterInformation, SignatureInformation } from 'vscode-languageserver'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isMessage,
  isMessageChain,
  isMessageOrChain,
  isRef,
  type Message,
  type MessageChain,
  type MessageOrChain,
} from './generated/ast.js'
import { getSharedChecker } from './shared-checker.js'
import { getBuiltinMethods } from './type-system.js'

/**
 * OOC 签名帮助提供者
 * 在消息调用时显示方法签名信息
 *
 * OOC 语法：
 * - `obj method arg1 arg2` -> MessageOrChain.primary = obj, MessageOrChain.message = { name: method, args: [arg1, arg2] }
 * - `a b c` -> 链式调用，MessageChain.primary = a, MessageChain.message = b, 然后再 c
 */
export class ObjectOrientedCSignatureHelpProvider extends AbstractSignatureHelpProvider {
  private readonly checker: ReturnType<typeof getSharedChecker>

  constructor(services: ObjectOrientedCServices) {
    super()
    this.checker = getSharedChecker(services)
  }

  /**
   * 签名帮助选项
   * OOC 语言使用空格作为方法调用分隔符
   */
  override get signatureHelpOptions(): SignatureHelpOptions {
    return {
      triggerCharacters: [' '],
      retriggerCharacters: [','],
    }
  }

  /**
   * 从元素获取签名帮助
   * Langium 会找到光标位置的节点并传递给此方法
   */
  protected override getSignatureFromElement(
    element: AstNode,
    _cancelToken: CancellationToken,
  ): MaybePromise<SignatureHelp | undefined> {
    try {
      // 情况1: 光标在 Message 节点上（消息名或参数上）
      if (isMessage(element)) {
        return this.getSignatureFromMessage(element)
      }

      // 情况2: 光标在 MessageOrChain 节点上
      if (isMessageOrChain(element)) {
        return this.getSignatureFromMessageOrChain(element)
      }

      // 情况3: 光标在 MessageChain 节点上
      if (isMessageChain(element)) {
        return this.getSignatureFromMessageChain(element)
      }

      // 情况4: 向上查找父节点是否是 Message 相关节点
      let current = element.$container
      while (current) {
        if (isMessage(current)) {
          return this.getSignatureFromMessage(current)
        }
        if (isMessageOrChain(current)) {
          return this.getSignatureFromMessageOrChain(current)
        }
        if (isMessageChain(current)) {
          return this.getSignatureFromMessageChain(current)
        }
        current = current.$container
      }

      return undefined
    } catch {
      return undefined
    }
  }

  /**
   * 从 Message 节点获取签名
   */
  private getSignatureFromMessage(message: Message): SignatureHelp | undefined {
    const name = this.getMessageName(message)
    if (!name) return undefined

    // 获取接收者类型
    const receiverType = this.getReceiverType(message)
    if (!receiverType) return undefined

    // 查找方法签名
    const sig = this.findSignature(receiverType, name)
    if (!sig) return undefined

    // 构建签名信息
    const params = this.buildParameters(sig)
    const label = this.buildSignatureLabel(name, sig)

    // 计算当前激活参数
    const activeParameter = this.computeActiveParameter(message)

    const signature: SignatureInformation = {
      label,
      parameters: params,
      activeParameter: activeParameter >= 0 ? activeParameter : undefined,
    }

    return {
      signatures: [signature],
      activeSignature: 0,
      activeParameter: activeParameter >= 0 ? activeParameter : 0,
    }
  }

  /**
   * 从 MessageOrChain 节点获取签名
   */
  private getSignatureFromMessageOrChain(node: MessageOrChain): SignatureHelp | undefined {
    // 如果有 message 字段，显示其签名
    if (node.message) {
      return this.getSignatureFromMessage(node.message)
    }

    // 否则尝试推断 primary 的类型
    const t = this.checker?.inferType(node.primary)
    if (t) {
      // 显示对象的所有可用方法
      if (t.kind === 'object' && t.methods) {
        const signatures: SignatureInformation[] = []
        for (const [methodName, sigs] of t.methods) {
          const sig = sigs[sigs.length - 1]
          const params = this.buildParameters(sig)
          const label = this.buildSignatureLabel(methodName, sig)
          signatures.push({ label, parameters: params })
        }
        if (signatures.length > 0) {
          return {
            signatures,
            activeSignature: 0,
            activeParameter: 0,
          }
        }
      }
    }

    return undefined
  }

  /**
   * 从 MessageChain 节点获取签名
   */
  private getSignatureFromMessageChain(node: MessageChain): SignatureHelp | undefined {
    // 显示当前 chain 中 message 的签名
    if (node.message) {
      return this.getSignatureFromMessage(node.message)
    }
    return undefined
  }

  /**
   * 获取消息接收者的类型
   */
  private getReceiverType(message: Message): any {
    const container = message.$container
    if (!container) return undefined

    // 如果容器是 MessageOrChain
    if (isMessageOrChain(container)) {
      return this.checker?.inferType(container.primary)
    }

    // 如果容器是 MessageChain
    if (isMessageChain(container)) {
      return this.checker?.inferType(container.primary)
    }

    return undefined
  }

  /**
   * 获取消息名
   */
  private getMessageName(message: Message): string | undefined {
    const nameNode = message.name
    if (!nameNode) return undefined

    // MethodCallName: { value: Ref | StID | Str }
    const value = nameNode.value
    if (!value) return undefined

    if (isRef(value)) {
      return value.value
    }
    if (typeof value === 'object' && 'value' in value) {
      return (value as any).value as string
    }
    return value as string
  }

  /**
   * 查找类型上的方法签名
   */
  private findSignature(type: any, name: string): any | undefined {
    if (!type) return undefined

    if (type.kind === 'object') {
      const sigs = type.methods?.get(name)
      if (sigs && sigs.length > 0) {
        return sigs[sigs.length - 1]
      }
    }

    // 查找内置方法
    if (type.kind === 'name') {
      const sigs = this.getBuiltinMethodSignatures(type.name, name)
      if (sigs && sigs.length > 0) {
        return sigs[sigs.length - 1]
      }
    }

    return undefined
  }

  /**
   * 获取内置方法签名
   */
  private getBuiltinMethodSignatures(typeName: string, methodName: string): any[] {
    try {
      const methods = getBuiltinMethods(typeName)
      return methods.get(methodName) ?? []
    } catch {
      return []
    }
  }

  /**
   * 构建参数信息
   */
  private buildParameters(sig: any): ParameterInformation[] {
    const params: ParameterInformation[] = []
    const sigParams = sig.params ?? []

    for (let i = 0; i < sigParams.length; i++) {
      const p = sigParams[i]
      const typeStr = p ? this.formatType(p) : 'any'
      params.push({
        label: `${i}: ${typeStr}`,
      })
    }

    return params
  }

  /**
   * 计算当前激活参数位置
   */
  private computeActiveParameter(message: Message): number {
    const args = message.args ?? []
    // 如果最后一个参数是逗号，activeParameter 是 args.length
    // 否则是最后一个参数的位置
    return Math.max(0, args.length - 1)
  }

  /**
   * 格式化类型
   */
  private formatType(t: any): string {
    if (!t) return 'any'
    if (typeof t === 'string') return t
    if (t.kind === 'name') return t.name
    if (t.kind === 'object') return t.name ?? '对象'
    if (t.kind === 'literal') return typeof t.value === 'string' ? `'${t.value}'` : String(t.value)
    return 'any'
  }

  /**
   * 构建签名标签
   */
  private buildSignatureLabel(name: string, sig: any): string {
    const params: string[] = []
    const sigParams = sig.params ?? []

    for (let i = 0; i < sigParams.length; i++) {
      const p = sigParams[i]
      params.push(p ? this.formatType(p) : 'any')
    }

    const returnStr = sig.returns ? this.formatType(sig.returns) : 'any'
    return `${name}(${params.join(', ')}) => ${returnStr}`
  }
}
