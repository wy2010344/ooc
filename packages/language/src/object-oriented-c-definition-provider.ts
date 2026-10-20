import {
  AstNode,
  AstUtils,
  CstNode,
  CstUtils,
  isCompositeCstNode,
  isLeafCstNode,
} from 'langium'
import type { LangiumDocument } from 'langium'
import { DefaultDefinitionProvider } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'
import {
  isAssignment,
  isImportStatement,
  isMethodAll,
  isModel,
  isRef,
  isStr,
} from './generated/ast.js'
import {
  DefinitionParams,
  LocationLink,
  Range,
} from 'vscode-languageserver'
import {
  findExportedNode,
  findImportBinding,
  findModuleResultNode,
  importDocument,
  resolveImportUri,
  type ImportResolution,
} from './import-binding.js'
import { leafAtTemplateHole } from './template-offsets.js'

/** 目标文件起始位置（跳到文件头即可，不定位到具体符号）。 */
const FILE_START_RANGE: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
}

/**
 * OOC 跳转定义提供�?
 * 支持跳转到变量定义，以及 #import 路径跳到目标模块文件�?
 */
export class ObjectOrientedCDefinitionProvider extends DefaultDefinitionProvider {

  constructor(private readonly services: ObjectOrientedCServices) {
    super(services)
  }

  /**
   * 光标落在模版洞 ${…} 内时，先切到洞内子解析出的表达式叶节点，再走常规解析。
   * 整段字符串是单个 STRING 叶节点，基类按文档偏移只会命中它，洞内引用无法跳转。
   */
  override async getDefinition(
    document: LangiumDocument,
    params: DefinitionParams,
  ): Promise<LocationLink[] | undefined> {
    const cstRoot = document.parseResult?.value?.$cstNode
    if (cstRoot) {
      const offset = document.textDocument.offsetAt(params.position)
      const leaf = CstUtils.findLeafNodeAtOffset(cstRoot, offset)
      if (leaf && isStr(leaf.astNode)) {
        const grafted = leafAtTemplateHole(leaf.astNode, offset)
        if (grafted) {
          return this.collectLocationLinks(grafted, params)
        }
      }
    }
    return super.getDefinition(document, params)
  }

  /**
   * 为变量引用提供定义位置
   */
  protected override collectLocationLinks(
    sourceCstNode: any,
    _params: any,
  ): LocationLink[] | undefined {
    const baseResult = super.collectLocationLinks(sourceCstNode, _params)
    const links: LocationLink[] = Array.isArray(baseResult) ? [...baseResult] : []

    // 尝试从 Ref 节点查找变量定义
    const sourceNode = sourceCstNode.astNode
    if (sourceNode && isRef(sourceNode)) {
      const varName = sourceNode.value
      const definitionNode = this.findDefinition(sourceNode, varName)
      if (definitionNode) {
        const link = this.createLocationLink(sourceCstNode, definitionNode, varName)
        if (link) {
          links.push(link)
        }
      } else {
        // 本文件没有声明：按 #import 绑定跳到被导入模块里的声明（或本文档的导入项）
        const importedLink = this.collectImportedBindingLink(sourceCstNode, sourceNode)
        if (importedLink) {
          links.push(importedLink)
        }
      }
    }

    // #import 路径 → 跳到目标模块文件
    const importLink = this.collectImportLink(sourceCstNode)
    if (importLink) {
      links.push(importLink)
    }

    return links
  }

  /**
   * 光标落在 #import 的路径字符串上时，解析出目标文件并返回跳转链接。
   */
  private collectImportLink(sourceCstNode: any): LocationLink | undefined {
    if (!isLeafCstNode(sourceCstNode)) return undefined
    const statement = sourceCstNode.astNode
    if (!statement || !isImportStatement(statement)) return undefined
    // 路径 token 是语句里唯一的字符串字面量（去掉首尾引号后等于 statement.path）
    const rawText: string = sourceCstNode.text
    if (rawText.length < 2) return undefined
    const quote = rawText[0]
    if ((quote !== "'" && quote !== '"') || rawText[rawText.length - 1] !== quote) {
      return undefined
    }
    if (rawText.slice(1, -1) !== statement.path) return undefined

    const targetUri = resolveImportUri(statement, this.importResolution())
    if (!targetUri) return undefined

    return {
      originSelectionRange: sourceCstNode.range,
      targetUri: targetUri.toString(),
      targetRange: FILE_START_RANGE,
      targetSelectionRange: FILE_START_RANGE,
    }
  }

  /**
   * 引用名走 #import 绑定：优先跳到被导入模块里的那条声明（变量/类型/再导出链），
   * 目标模块没加载或找不到对应声明时，退回到本文档的导入项（`{ Button }` 里的 Button）。
   */
  private collectImportedBindingLink(
    sourceCstNode: any,
    refNode: any,
  ): LocationLink | undefined {
    const model = AstUtils.getContainerOfType(refNode, isModel)
    if (!model) return undefined
    const binding = findImportBinding(model, refNode.value)
    if (!binding) return undefined

    const res = this.importResolution()
    const target = importDocument(binding.stmt, res)
    const targetModel = target?.parseResult.value
    if (targetModel && isModel(targetModel)) {
      const node =
        binding.kind === 'default'
          ? findModuleResultNode(targetModel)
          : findExportedNode(targetModel, binding.exportName, res)
      if (node) {
        // 默认导出可能是任意表达式：只在名字确实等于导出名时按名字定位
        const name = binding.kind === 'default' ? undefined : binding.exportName
        const link = this.createLocationLink(sourceCstNode, node, name)
        if (link) return link
      }
    } else {
      // 目标不是/未加载为 Langium 文档（宿主 .ts 等）：文件在就跳文件头
      const uri = resolveImportUri(binding.stmt, res)
      if (uri) {
        return {
          originSelectionRange: sourceCstNode.range,
          targetUri: uri.toString(),
          targetRange: FILE_START_RANGE,
          targetSelectionRange: FILE_START_RANGE,
        }
      }
    }
    // 回退：本文档的导入项就是这个名字的「定义位置」
    return binding.item
      ? this.createLocationLink(sourceCstNode, binding.item)
      : undefined
  }

  /** DefinitionProvider 侧的 #import 解析上下文 */
  private importResolution(): ImportResolution {
    const workspace = this.services.shared.workspace
    return {
      getDocument: (uri) => workspace.LangiumDocuments.getDocument(uri),
      exists: (uri) => workspace.FileSystemProvider.existsSync(uri),
      extensions: this.services.LanguageMetaData.fileExtensions,
    }
  }

  /**
   * 在 AST 中查找变量定义
   */
  private findDefinition(
    node: AstNode,
    name: string,
  ): AstNode | undefined {
    let current: AstNode | undefined = node.$container
    while (current) {
      const found = this.searchInScope(current, name)
      if (found) return found
      current = current.$container
    }
    return undefined
  }

  /**
   * 在节点的子树中搜索变量定义
   */
  private searchInScope(node: AstNode, name: string): AstNode | undefined {
    // 方法体（含实现方法）里的赋值定义；body 抽到 MethodBody 后字段在 body 上
    if (isMethodAll(node) && node.body) {
      for (const expr of node.body.stmts) {
        if (isAssignment(expr) && expr.name === name) {
          return expr
        }
      }
    }
    if ('expressions' in node && Array.isArray((node as any).expressions)) {
      for (const expr of (node as any).expressions) {
        if (isAssignment(expr) && expr.name === name) {
          return expr
        }
      }
    }
    return undefined
  }

  /**
   * 创建位置链接。给了 name 时把范围收窄到名字那个叶节点（跨文档声明也适用）。
   */
  private createLocationLink(
    sourceCstNode: any,
    targetNode: AstNode,
    name?: string,
  ): LocationLink | undefined {
    const nodeCst = targetNode.$cstNode
    // 优先按名字定位（Assignment/TypeDef/ImportItem 的 $cstNode 都覆盖整条语句）
    const nameCstNode = name && nodeCst ? this.findLeafWithText(nodeCst, name) : undefined
    const targetCstNode = nameCstNode ?? this.findNameCstNode(targetNode) ?? nodeCst
    if (!targetCstNode) return undefined

    const targetRange = targetCstNode.range
    if (!targetRange) return undefined

    const sourceRange = sourceCstNode.range

    // 获取文档 URI：通过 AST 节点的 $document 属性
    const documentUri = this.getDocumentUri(targetNode)
    if (!documentUri) return undefined

    return {
      originSelectionRange: sourceRange ? {
        start: {
          line: sourceRange.start.line,
          character: sourceRange.start.character,
        },
        end: {
          line: sourceRange.end.line,
          character: sourceRange.end.character,
        },
      } : undefined,
      targetUri: documentUri,
      targetRange: {
        start: {
          line: targetRange.start.line,
          character: targetRange.start.character,
        },
        end: {
          line: targetRange.end.line,
          character: targetRange.end.character,
        },
      },
      targetSelectionRange: {
        start: {
          line: targetRange.start.line,
          character: targetRange.start.character,
        },
        end: {
          line: targetRange.end.line,
          character: targetRange.end.character,
        },
      },
    }
  }

  /**
   * 查找变量名的 CST 叶节点
   *
   * Langium 的 CST 是嵌套结构：Assignment 的 $cstNode 是一个复合节点，
   * 其子节点可能仍是复合节点（如嵌套的 Assignment 层），
   * 最终才到叶节点（x、=、42 等）。
   * 必须递归查找叶节点，而不仅仅是直接子节点。
   */
  private findNameCstNode(node: AstNode): CstNode | undefined {
    if (!isAssignment(node) || !node.name) return undefined
    const cstNode = node.$cstNode
    if (!cstNode) return undefined
    return this.findLeafWithText(cstNode, node.name)
  }

  /**
   * 递归在 CST 树中查找文本匹配的叶节点
   */
  private findLeafWithText(cstNode: CstNode, text: string): CstNode | undefined {
    if (isLeafCstNode(cstNode)) {
      return cstNode.text === text ? cstNode : undefined
    }
    if (isCompositeCstNode(cstNode)) {
      for (const child of cstNode.content) {
        const found = this.findLeafWithText(child, text)
        if (found) return found
      }
    }
    return undefined
  }

  /**
   * 获取 AST 节点所在文档的 URI
   */
  private getDocumentUri(node: AstNode): string | undefined {
    // 向上遍历找到根节点（根节点有 $document 属性）
    let current: AstNode | undefined = node
    while (current) {
      if (current.$document) {
        return current.$document.uri.toString()
      }
      current = current.$container
    }
    return undefined
  }
}