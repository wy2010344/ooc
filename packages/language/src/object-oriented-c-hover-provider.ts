import { AstNode, MaybePromise } from 'langium'
import { AstNodeHoverProvider } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isBool,
  isExpression,
  isImportStatement,
  isLambdaDef,
  isMessage,
  isMessageOrChain,
  isMethodAll,
  isMethodBind,
  isMethodBindMutable,
  isNil,
  isNum,
  isPrimary,
  isRef,
  isStr,
  isStID,
  type Message,
  type MethodCallName,
} from './generated/ast.js'
import { getSharedChecker } from './shared-checker.js'
import {
  describeType,
  getBuiltinMethods,
  typeToString,
  type TypeInfo,
} from './type-system.js'

/**
 * OOC Hover 提供者
 * - 显示类型信息
 * - 使用 Langium CommentProvider 获取注释
 */
export class ObjectOrientedCHoverProvider extends AstNodeHoverProvider {
  private readonly checker: ReturnType<typeof getSharedChecker>
  private readonly oocServices: ObjectOrientedCServices

  constructor(services: ObjectOrientedCServices) {
    super(services)
    this.oocServices = services
    this.checker = getSharedChecker(services)
  }

  protected override getAstNodeHoverContent(
    node: AstNode,
  ): MaybePromise<string | undefined> {
    // 使用 Langium 的 CommentProvider 获取注释
    const comment = this.getNodeComment(node)

    if (isImportStatement(node)) {
      return this.buildHoverContent(
        `导入 ${node.name}：${describeHoverType(this.checker.inferType(node))}`,
        comment,
      )
    }
    if (isMethodAll(node)) {
      const params = node.params?.map((p) => p.name).join(', ') || ''
      const rest = node.restParam ? `, ...${node.restParam.name}` : ''
      const ret = node.returnType
        ? ` : ${typeToString(node.returnType)}`
        : ''
      return this.buildHoverContent(
        `方法 ${methodDefName(node.name)}(${params}${rest})${ret}`,
        comment,
      )
    }
    if (isMethodBind(node)) {
      const typeAnno = node.typeAnnotation
        ? `: ${typeToString(node.typeAnnotation)}`
        : ''
      return this.buildHoverContent(
        `绑定 ${node.name}${typeAnno}`,
        comment,
      )
    }
    if (isMethodBindMutable(node)) {
      const typeAnno = node.typeAnnotation
        ? `: ${typeToString(node.typeAnnotation)}`
        : ''
      return this.buildHoverContent(
        `可变属性 ${node.name}${typeAnno}（无参读取，有参修改）`,
        comment,
      )
    }
    if (isLambdaDef(node)) {
      const t = this.checker.inferType(node)
      if (t.kind === 'object') {
        const sig = t.methods.get('apply')?.[0]
        if (sig) {
          const params = (sig.params ?? [])
            .map((p) => (p ? describeType(p) : 'any'))
            .join(', ')
          return this.buildHoverContent(
            `λ(${params}) => ${describeType(sig.returns)}`,
            comment,
          )
        }
      }
      return this.buildHoverContent('λ（匿名函数）', comment)
    }
    if (isAssignment(node)) {
      const t = this.checker.inferType(node.expression)
      const anno = node.typeAnnotation
        ? `（注解 ${typeToString(node.typeAnnotation)}）`
        : ''
      return this.buildHoverContent(
        `变量 ${node.name}：${describeHoverType(t)}${anno}`,
        comment,
      )
    }
    // 消息调用：显示方法签名和返回类型
    if (isMessage(node)) {
      return this.handleMessageHover(node, comment)
    }
    // 消息链：显示接收者类型和调用结果
    if (isMessageOrChain(node)) {
      return this.handleMessageChainHover(node, comment)
    }
    // 引用：显示变量类型
    if (isRef(node)) {
      const t = this.checker.inferType(node)
      return this.buildHoverContent(
        `引用 ${node.value}：${describeHoverType(t)}`,
        comment,
      )
    }
    // 字面量类型
    if (isNum(node)) {
      return this.buildHoverContent(
        `数字 ${node.value}：number`,
        comment,
      )
    }
    if (isStr(node)) {
      return this.buildHoverContent(
        `字符串 ${node.value}：string`,
        comment,
      )
    }
    if (isBool(node)) {
      return this.buildHoverContent(
        `布尔 ${node.value}：bool`,
        comment,
      )
    }
    if (isNil(node)) {
      return this.buildHoverContent(`nil：null`, comment)
    }
    if (isExpression(node) || isPrimary(node)) {
      const t = this.checker.inferType(node)
      return this.buildHoverContent(describeHoverType(t), comment)
    }
    return undefined
  }

  /**
   * 使用 Langium CommentProvider 获取节点注释
   */
  private getNodeComment(node: AstNode): string {
    // 从服务中获取 CommentProvider
    const services = this.oocServices
    if (services.documentation?.CommentProvider) {
      const comment = services.documentation.CommentProvider.getComment(node)
      if (comment) {
        return comment
      }
    }
    
    // 回退：简单的注释提取
    return this.extractCommentFallback(node)
  }

  /**
   * 回退的注释提取方法
   */
  private extractCommentFallback(node: AstNode): string {
    const cstNode = node.$cstNode
    if (!cstNode) return ''
    
    // 查找前导注释
    const rootNode = cstNode.root
    const fullText = rootNode.text
    const nodeOffset = cstNode.offset
    
    // 简单策略：查找节点前面的注释
    const beforeText = fullText.substring(0, nodeOffset)
    const commentMatch = beforeText.match(/\/\/.*$/gm)
    if (commentMatch && commentMatch.length > 0) {
      // 取最后几条连续注释
      const lastComments = commentMatch.slice(-3).map(c => c.replace(/^\/\/\s*/, ''))
      return lastComments.join('\n')
    }
    
    return ''
  }

  /** 处理消息调用的 hover：显示方法签名 */
  private handleMessageHover(
    message: Message,
    comment: string,
  ): string {
    const name = this.getMethodCallName(message.name)
    const container = message.$container
    let receiverType: TypeInfo | undefined

    if (container && isMessageOrChain(container)) {
      receiverType = this.checker.inferType(container.primary)
    }

    if (receiverType) {
      const sig = this.findMethodSignature(receiverType, name)
      if (sig) {
        const params = (sig.params ?? [])
          .map((p) => (p ? describeType(p) : 'any'))
          .join(', ')
        const rest = sig.rest ? `, ...${describeType(sig.rest)}` : ''
        return this.buildHoverContent(
          `${describeType(receiverType)}.${name}(${params}${rest}) => ${describeType(sig.returns)}`,
          comment,
        )
      }
      return this.buildHoverContent(
        `消息 ${name} 发送给 ${describeType(receiverType)}`,
        comment,
      )
    }
    return this.buildHoverContent(`消息 ${name}`, comment)
  }

  /** 处理消息链的 hover */
  private handleMessageChainHover(
    node: AstNode,
    comment: string,
  ): string {
    const t = this.checker.inferType(node)
    return this.buildHoverContent(describeHoverType(t), comment)
  }

  /** 查找类型上的方法签名 */
  private findMethodSignature(
    type: TypeInfo,
    name: string,
  ): { params: (TypeInfo | undefined)[]; rest?: TypeInfo; returns: TypeInfo } | undefined {
    if (type.kind === 'object') {
      const sigs = type.methods.get(name)
      if (sigs && sigs.length > 0) {
        return sigs[sigs.length - 1]
      }
    }
    if (type.kind === 'name') {
      const sigs = getBuiltinMethods(type.name).get(name)
      if (sigs && sigs.length > 0) {
        return sigs[sigs.length - 1]
      }
    }
    return undefined
  }

  /** 获取方法调用名 */
  private getMethodCallName(
    name: MethodCallName,
  ): string {
    const v = name.value
    if (isRef(v)) {
      return v.value
    }
    if (isStID(v)) {
      return v.value.slice(1)
    }
    return v.value
  }

  /** 构建 hover 内容：类型信息 + 注释 */
  private buildHoverContent(
    typeInfo: string,
    comment: string,
  ): string {
    if (comment) {
      return `${typeInfo}\n\n---\n\n${comment}`
    }
    return typeInfo
  }
}

/** 从 MethodDefName 取出方法名 */
function methodDefName(name: {
  name: { $type: string; value: string }
}): string {
  const v = name.name
  if (isRef(v)) {
    return v.value
  }
  if (isStID(v)) {
    return v.value.slice(1)
  }
  return v.value
}

/** 对象的悬停展示：列出方法签名 */
function describeHoverType(t: TypeInfo): string {
  if (t.kind === 'union') {
    const branches = t.types.map(describeHoverType).join('\n')
    return `联合类型\n${branches}`
  }
  if (t.kind === 'object') {
    const head = t.name
      ? `类型 ${t.name}${t.parent ? ` (extends ${t.parent})` : ''}`
      : `对象${t.parent ? ` (extends ${t.parent})` : ''}`
    const lines = [...t.methods.entries()].flatMap(([name, sigs]) =>
      sigs.map((sig) => {
        const params = (sig.params ?? [])
          .map((p) => (p ? describeType(p) : 'any'))
          .join(', ')
        const rest = sig.rest ? `, ...${describeType(sig.rest)}` : ''
        return `${name}(${params}${rest}) => ${describeType(sig.returns)}`
      }),
    )
    return lines.length
      ? `${head}\n${lines.map((l) => `- ${l}`).join('\n')}`
      : head
  }
  return describeType(t)
}
