/**
 * 导入绑定的解析：把引用名对应到 #import 的绑定项，并尽量定位到被导入模块里的声明。
 * DefinitionProvider / HoverProvider 共用（两者都要「跳到 / 看到定义」）。
 *
 * #import 一条语句三种成分（见 grammar）：
 *   x = #import 'p'         默认导入：绑定模块结果（最后一条表达式）
 *   #import { a as b } 'p'  命名导入：绑定模块顶层声明（值或类型）
 *   #import 'p' { T }       类型导入：注册类型别名
 */
import { AstUtils, URI, type AstNode, type LangiumDocument } from 'langium'
import {
  isAssignment,
  isImportStatement,
  isModel,
  isTypeDef,
  type ImportItem,
  type ImportStatement,
  type Model,
} from './generated/ast.js'
import {
  PACKAGE_URI_PREFIX,
  dirnameOf,
  joinPath,
  resolveModuleName,
} from './module-path.js'

/** #import 的绑定形态 */
export interface ImportBinding {
  /** 绑定所在的 #import 语句 */
  stmt: ImportStatement
  kind: 'named' | 'default' | 'type'
  /** 当前文档里可见的名字（有 as 时是别名） */
  localName: string
  /** 被导入模块里的名字（有 as 时是原名） */
  exportName: string
  /** 命名/类型导入的条目；默认导入没有 */
  item?: ImportItem
}

/**
 * 在当前模型的 #import 语句里找与 name 匹配的绑定。
 * 反向遍历：同名重复绑定时以靠后的语句为准（与顶层求值顺序一致）。
 */
export function findImportBinding(
  model: Model,
  name: string,
): ImportBinding | undefined {
  const statements = model.expressions.filter(isImportStatement)
  for (let i = statements.length - 1; i >= 0; i--) {
    const stmt = statements[i]!
    const item = stmt.named?.items.find((x) => (x.alias ?? x.name) === name)
    if (item) {
      return { stmt, kind: 'named', localName: name, exportName: item.name, item }
    }
    const typeItem = stmt.types?.items.find((x) => (x.alias ?? x.name) === name)
    if (typeItem) {
      return {
        stmt,
        kind: 'type',
        localName: name,
        exportName: typeItem.name,
        item: typeItem,
      }
    }
    if (stmt.name === name) {
      return { stmt, kind: 'default', localName: name, exportName: name }
    }
  }
  return undefined
}

/** 解析 #import 目标所需的最小上下文（Provider 里从 services 取） */
export interface ImportResolution {
  /** 按 URI 取已加载文档（LangiumDocuments.getDocument） */
  getDocument(uri: URI): LangiumDocument | undefined
  /** 目标文件是否存在（未加载时也能确认跳转目标） */
  exists(uri: URI): boolean
  /** 语言扩展名（#import 省略扩展名时补全） */
  extensions: readonly string[]
}

/**
 * 把 #import 路径解析成目标文件 URI。
 * 相对路径按导入文件所在目录解析；@pkg 包引用从导入文件所在目录向上找
 * .ooc_modules/<pkg>（与 CLI `ooc install` 的落盘位置一致）。
 */
export function resolveImportUri(
  stmt: ImportStatement,
  res: ImportResolution,
): URI | undefined {
  const doc = AstUtils.getDocument(stmt)
  const resolved = resolveModuleName(stmt.path, doc.uri.path, res.extensions)
  const known = (uri: URI) => !!res.getDocument(uri) || res.exists(uri)

  if (resolved.startsWith(PACKAGE_URI_PREFIX + '/')) {
    const rest = resolved.slice(PACKAGE_URI_PREFIX.length + 1)
    let dir = dirnameOf(doc.uri.path)
    while (dir) {
      const candidate = URI.file(joinPath(dir, `.ooc_modules/${rest}`))
      if (known(candidate)) return candidate
      const parent = dirnameOf(dir)
      if (parent === dir) break
      dir = parent
    }
    return undefined
  }
  const uri = URI.file(resolved)
  return known(uri) ? uri : undefined
}

/** 目标模块文档（目标未加载时为 undefined） */
export function importDocument(
  stmt: ImportStatement,
  res: ImportResolution,
): LangiumDocument | undefined {
  const uri = resolveImportUri(stmt, res)
  const doc = uri ? res.getDocument(uri) : undefined
  const model = doc?.parseResult.value
  return model && isModel(model) ? doc : undefined
}

/**
 * 在模块里找「导出名」对应的顶层声明：变量/类型声明，或沿再导出链继续往上游模块找。
 * 找不到返回 undefined（名字可能由嵌套对象承载，此时调用方回退到导入项本身）。
 */
export function findExportedNode(
  model: Model,
  exportName: string,
  res: ImportResolution,
  seen: Set<Model> = new Set(),
): AstNode | undefined {
  if (seen.has(model)) return undefined
  seen.add(model)
  for (const stmt of model.expressions) {
    if ((isAssignment(stmt) || isTypeDef(stmt)) && stmt.name === exportName) {
      return stmt
    }
    if (!isImportStatement(stmt)) continue
    const item = stmt.named?.items.find((x) => (x.alias ?? x.name) === exportName)
    if (!item) continue
    const upstream = importDocument(stmt, res)
    const upstreamModel = upstream?.parseResult.value
    if (upstreamModel && isModel(upstreamModel)) {
      const found = findExportedNode(upstreamModel, item.name, res, seen)
      if (found) return found
    }
  }
  return undefined
}

/** 模块的默认导出 = 最后一条语句（语句顺序即求值顺序，最后一条是模块结果） */
export function findModuleResultNode(model: Model): AstNode | undefined {
  return model.expressions[model.expressions.length - 1]
}
