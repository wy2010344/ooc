/**
 * 共享 TypeChecker 工厂
 * 使用 WeakMap 按服务实例存储，避免全局单例问题
 */

import type { LangiumServices } from 'langium/lsp'
import type { TypeInfo } from './type-system.js'
import {
  createImportResolver,
  ObjectOrientedCTypeChecker,
} from './type-checker.js'

/**
 * 使用 WeakMap 存储每个服务实例对应的 checker 状态
 * 当服务实例被 GC 时，对应的 checker 也会被自动回收
 */
interface CheckerEntry {
  /** 创建 checker 时抓取的有效全局类型引用，比对引用是否变化决定是否重建 */
  globalsRef: Map<string, TypeInfo> | undefined
  checker: ObjectOrientedCTypeChecker
}

const checkerMap = new WeakMap<object, CheckerEntry>()

/**
 * 获取指定服务的共享 TypeChecker 实例
 * 如果不存在则创建新的；有效全局类型引用变化时重建（per-doc 会替换 globalsTypes
 * 映射，快照会陈旧，导致 hover/补全看不到最新注入的全局类型 —— #2 修复）。
 */
export function getSharedChecker(services: LangiumServices): ObjectOrientedCTypeChecker {
  // 使用服务对象作为 key（WeakMap 不会阻止 GC）
  const key = services as unknown as object

  // 复用 validator 注入的全局桥接类型，让 hover/补全也能看到 dom/fc 等
  const validator = (services as unknown as {
    validation?: { ObjectOrientedCValidator: { getGlobalTypes(): Map<string, TypeInfo> | undefined } }
  }).validation?.ObjectOrientedCValidator
  const currentGlobals = validator?.getGlobalTypes()

  const entry = checkerMap.get(key)
  if (entry && entry.globalsRef === currentGlobals) {
    return entry.checker
  }
  const checker = new ObjectOrientedCTypeChecker(
    createImportResolver(
      services.shared.workspace.LangiumDocuments,
      services.LanguageMetaData.fileExtensions,
    ),
    currentGlobals,
  )
  checkerMap.set(key, { globalsRef: currentGlobals, checker })
  return checker
}

/**
 * 重置指定服务的 checker（主要用于测试）
 */
export function resetChecker(services: LangiumServices): void {
  const key = services as unknown as object
  checkerMap.delete(key)
}
