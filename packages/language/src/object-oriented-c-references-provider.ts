import { DefaultReferencesProvider } from 'langium/lsp'
import { ObjectOrientedCServices } from './object-oriented-c-module.js'

/**
 * OOC 查找引用提供者
 * 继承 Langium 默认实现，使用语法级引用解析
 */
export class ObjectOrientedCReferencesProvider extends DefaultReferencesProvider {

  constructor(services: ObjectOrientedCServices) {
    super(services)
  }
}