import { type LangiumServices } from 'langium/lsp'
import {
  createImportResolver,
  ObjectOrientedCTypeChecker,
} from './type-checker.js'

/**
 * 全局共享的 TypeChecker 工厂
 * 避免每个 Provider 都创建新的 checker 实例
 */
let sharedChecker: ObjectOrientedCTypeChecker | undefined

/**
 * 获取共享的 TypeChecker 实例
 */
export function getSharedChecker(services: LangiumServices): ObjectOrientedCTypeChecker {
  if (!sharedChecker) {
    sharedChecker = new ObjectOrientedCTypeChecker(
      createImportResolver(
        services.shared.workspace.LangiumDocuments,
        services.LanguageMetaData.fileExtensions,
      ),
    )
  }
  return sharedChecker
}

/**
 * 重置共享 checker（主要用于测试）
 */
export function resetSharedChecker(): void {
  sharedChecker = undefined
}
