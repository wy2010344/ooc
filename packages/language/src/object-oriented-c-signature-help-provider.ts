import { AstNode, MaybePromise } from 'langium'
import { AbstractSignatureHelpProvider } from 'langium/lsp'
import type { SignatureHelpOptions } from 'vscode-languageserver'
import type { CancellationToken } from 'vscode-jsonrpc'
import type { SignatureHelp } from 'vscode-languageserver'
import type { ParameterInformation, SignatureInformation } from 'vscode-languageserver'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isMessageOrChain,
  type Message,
} from './generated/ast.js'
import { getSharedChecker } from './shared-checker.js'

/**
 * OOC 签名帮助提供者
 * 在消息调用时显示方法签名信息
 */
export class ObjectOrientedCSignatureHelpProvider extends AbstractSignatureHelpProvider {
  private readonly checker: ReturnType<typeof getSharedChecker>

  constructor(services: ObjectOrientedCServices) {
    super()
    this.checker = getSharedChecker(services)
  }

  override get signatureHelpOptions(): SignatureHelpOptions {
    return {
      triggerCharacters: [' ', ','],
    }
  }

  protected override getSignatureFromElement(
    element: AstNode,
    _cancelToken: CancellationToken,
  ): MaybePromise<SignatureHelp | undefined> {
    if (!isMessageOrChain(element)) {
      return undefined
    }

    const message = this.findMessage(element)
    if (!message) return undefined

    try {
      const receiverType = this.getReceiverType(message)
      if (!receiverType) return undefined

      const name = this.getMessageName(message)
      const sig = this.findSignature(receiverType, name)
      if (!sig) return undefined

      const params = this.buildParameters(sig)
      const label = this.buildSignatureLabel(name, sig)
      
      const signature: SignatureInformation = {
        label,
        parameters: params,
      }

      // 计算当前激活参数
      const activeParameter = message.args.length

      return {
        signatures: [signature],
        activeSignature: 0,
        activeParameter,
      }
    } catch {
      return undefined
    }
  }

  /** 从节点找到 Message */
  private findMessage(node: AstNode): Message | undefined {
    if (isMessageOrChain(node) && node.message) {
      return node.message
    }
    return undefined
  }

  /** 获取消息接收者的类型 */
  private getReceiverType(message: Message): any {
    const container = message.$container
    if (!container || !isMessageOrChain(container)) {
      return undefined
    }
    return this.checker.inferType(container.primary)
  }

  /** 获取消息名 */
  private getMessageName(message: Message): string {
    const name = message.name.value
    if (name && typeof name === 'object' && 'value' in name) {
      return (name as any).value as string
    }
    return name as string
  }

  /** 查找类型上的方法签名 */
  private findSignature(type: any, name: string): any | undefined {
    if (!type) return undefined
    if (type.kind === 'object') {
      const sigs = type.methods.get(name)
      if (sigs && sigs.length > 0) {
        return sigs[sigs.length - 1]
      }
    }
    return undefined
  }

  /** 构建参数信息 */
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

  /** 格式化类型 */
  private formatType(t: any): string {
    if (!t) return 'any'
    if (typeof t === 'string') return t
    if (t.kind === 'name') return t.name
    if (t.kind === 'object') return t.name ?? '对象'
    return 'any'
  }

  /** 构建签名标签 */
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
