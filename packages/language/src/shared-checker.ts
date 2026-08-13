/**
 * 共享 TypeChecker 工厂
 * 使用 WeakMap 按服务实例存储，避免全局单例问题
 */

import type { LangiumServices } from 'langium/lsp'
import {
  createImportResolver,
  ObjectOrientedCTypeChecker,
} from './type-checker.js'

/**
 * 使用 WeakMap 存储每个服务实例对应的 checker
 * 当服务实例被 GC 时，对应的 checker 也会被自动回收
 */
const checkerMap = new WeakMap<object, ObjectOrientedCTypeChecker>()

/**
 * 获取指定服务的共享 TypeChecker 实例
 * 如果不存在则创建新的
 */
export function getSharedChecker(services: LangiumServices): ObjectOrientedCTypeChecker {
  // 使用服务对象作为 key（WeakMap 不会阻止 GC）
  const key = services as unknown as object
  
  let checker = checkerMap.get(key)
  if (!checker) {
    checker = new ObjectOrientedCTypeChecker(
      createImportResolver(
        services.shared.workspace.LangiumDocuments,
        services.LanguageMetaData.fileExtensions,
      ),
    )
    checkerMap.set(key, checker)
  }
  return checker
}

/**
 * 重置指定服务的 checker（主要用于测试）
 */
export function resetChecker(services: LangiumServices): void {
  const key = services as unknown as object
  checkerMap.delete(key)
}
