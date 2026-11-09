// 构建期未定义引用检查：① 跨模块 `#import { X }` 里不存在的 X；
// ② 模块内拼错 / 漏写的裸名字（与 LSP / `ooc type-check` 共用同一套判定）。
// 宿主注入的 globals 由插件 options.globals 补进已知名字，避免误报。

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import { resolveImportSource } from 'object-oriented-c-cli'
import { findUndefinedReferences } from 'object-oriented-c-language'
import type { Model } from 'object-oriented-c-language'

/**
 * 项目 config.ooc 的 `globals = { … }` 名单：这些名字由宿主注入，源码里
 * 不必写 #import。拒绝在这里重造一份名单，直接读项目已有声明。
 */
export function configGlobalNames(fromId: string): string[] {
  let dir = path.dirname(fromId)
  for (;;) {
    const file = path.join(dir, 'config.ooc')
    if (fs.existsSync(file)) return globalNamesFrom(fs.readFileSync(file, 'utf8'))
    const parent = path.dirname(dir)
    if (parent === dir) return []
    dir = parent
  }
}

/** 括号配对取出 globals 块，再扫块内的成员名（只认 `name =` 形态） */
function globalNamesFrom(text: string): string[] {
  const at = text.search(/\bglobals\s*=\s*\{/)
  if (at < 0) return []
  const open = text.indexOf('{', at)
  let depth = 0
  let end = -1
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  if (end < 0) return []
  const body = text.slice(open + 1, end)
  return [...body.matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1])
}

/** 模块内裸名字：漏定义时直接构建失败，别等浏览器里 ReferenceError */
export function checkLocalUndefinedRefs(
  model: Model,
  id: string,
  globals: Iterable<string> = [],
): void {
  const missing = findUndefinedReferences(model, globals)
  if (missing.length === 0) return
  const names = [...new Set(missing.map((ref) => ref.value))]
  throw new Error(
    `OOC 未定义引用 ${id}: ${names.join(', ')} —— 本模块没有该声明，也不是 #import 绑定、宿主全局或 JS 内建`,
  )
}

export interface ExportSet {
  names: Set<string>
  /** false 表示存在 `export *`，无法静态穷举，跳过检查 */
  complete: boolean
}

/** .ooc 顶层声明 + 再导出的 import 绑定，都是可具名导入的名字 */
export function oocExportNames(model: Model): Set<string> {
  const names = new Set<string>()
  for (const st of model.expressions as any[]) {
    if (st.$type === 'Assignment' && st.name) names.add(st.name)
    else if (st.$type === 'TypeDef' && st.name) names.add(st.name)
    else if (st.$type === 'ImportStatement') {
      if (st.name) names.add(st.name)
      for (const list of [st.named, st.types]) {
        for (const item of list?.items ?? []) names.add(item.alias ?? item.name)
      }
    }
  }
  return names
}

/** .ts/.js 的具名导出（含 `export { a as b }` 与 default） */
export function tsExportNames(source: string, file: string): ExportSet {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const names = new Set<string>()
  let complete = true
  const mods = (node: ts.Node): readonly ts.ModifierLike[] =>
    (node as any).modifiers ?? []
  const isExported = (node: ts.Node) =>
    mods(node).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (!st.exportClause) {
        complete = false
        continue
      }
      if (ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) names.add(e.name.text)
      }
      continue
    }
    if (ts.isExportAssignment(st)) {
      names.add('default')
      continue
    }
    if (!isExported(st)) continue
    if (mods(st).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      names.add('default')
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text)
      }
    } else if (
      (ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isInterfaceDeclaration(st) ||
        ts.isTypeAliasDeclaration(st) ||
        ts.isEnumDeclaration(st)) &&
      st.name
    ) {
      names.add(st.name.text)
    }
  }
  return { names, complete }
}

export interface ImportRefChecker {
  /** 检查单条 #import 语句的具名引用；不通过时抛 Error（构建期失败） */
  check(fromId: string, st: any): void
  /** 文件改动时清掉该目标的导出名缓存 */
  invalidate(file: string): void
}

export function createImportRefChecker(
  parseModel: (code: string, id: string) => Model,
): ImportRefChecker {
  const cache = new Map<string, ExportSet | null>()

  /** 目标解析不了（裸包 / 目录 / 不存在）时返回 null，交给 vite 自己报错 */
  function exportSetOf(target: string): ExportSet | null {
    if (cache.has(target)) return cache.get(target) ?? null
    let out: ExportSet | null = null
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      const src = fs.readFileSync(target, 'utf8')
      if (target.endsWith('.ooc')) {
        out = { names: oocExportNames(parseModel(src, target)), complete: true }
      } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(target)) {
        out = tsExportNames(src, target)
      }
    }
    cache.set(target, out)
    return out
  }

  return {
    check(fromId: string, st: any): void {
      const items = [...(st.named?.items ?? []), ...(st.types?.items ?? [])]
      if (items.length === 0) return
      let target: string
      try {
        target = resolveImportSource(st.path, fromId)
      } catch {
        return
      }
      const set = exportSetOf(target)
      if (!set || !set.complete) return
      const missing = items
        .map((item: any) => item.name as string)
        .filter((name) => !set.names.has(name))
      if (missing.length > 0) {
        throw new Error(
          `OOC 未定义引用 ${fromId}: #import '${st.path}' 中的 ${missing.join(', ')} 在 ${target} 里没有对应导出`,
        )
      }
    },
    invalidate(file: string): void {
      cache.delete(file)
    },
  }
}
