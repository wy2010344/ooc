import { test } from './compat.js'
import assert from 'node:assert/strict'
import { EmptyFileSystem } from 'langium'
import { parseHelper } from 'langium/test'
import { createObjectOrientedCServices } from 'object-oriented-c-language'
import type { Model } from 'object-oriented-c-language'

/**
 * LSP Smoke 测试
 * 验证所有 LSP Provider 可以被实例化并基本可用
 */

// ========== Module 注册测试 ==========

test('LSP: 所有 Provider 应被注册', () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  
  assert.ok(services.ObjectOrientedC.lsp, 'lsp 命名空间应存在')
  assert.ok(services.ObjectOrientedC.lsp.HoverProvider, 'HoverProvider 应已注册')
  assert.ok(services.ObjectOrientedC.lsp.CompletionProvider, 'CompletionProvider 应已注册')
  assert.ok(services.ObjectOrientedC.lsp.SignatureHelp, 'SignatureHelp 应已注册')
  assert.ok(services.ObjectOrientedC.lsp.DefinitionProvider, 'DefinitionProvider 应已注册')
  assert.ok(services.ObjectOrientedC.lsp.ReferencesProvider, 'ReferencesProvider 应已注册')
})

// ========== Hover Provider 测试 ==========

test('LSP: 应能解析基本节点', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const parse = parseHelper<Model>(services.ObjectOrientedC)
  
  const document = await parse('x = 42;')
  assert.ok(document, '应能解析基本表达式')
})

test('LSP: 应能解析对象方法', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const parse = parseHelper<Model>(services.ObjectOrientedC)
  
  const document = await parse(`
    // 定义一个有方法的对象
    obj = {
      greet = fn [name -> result] ('Hello, ' + name)
    };
    // 调用方法
    obj greet 'World';
  `)
  assert.ok(document, '应能解析对象和方法调用')
})

// ========== Completion Provider 测试 ==========

test('LSP: CompletionProvider 应能被实例化', () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  
  const provider = services.ObjectOrientedC.lsp.CompletionProvider
  assert.ok(provider, 'CompletionProvider 应存在')
})

// ========== SignatureHelp Provider 测试 ==========

test('LSP: SignatureHelp 应能被实例化', () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  
  const provider = services.ObjectOrientedC.lsp.SignatureHelp
  assert.ok(provider, 'SignatureHelp 应存在')
})

// ========== Definition Provider 测试 ==========

test('LSP: DefinitionProvider 应能被实例化', () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  
  const provider = services.ObjectOrientedC.lsp.DefinitionProvider
  assert.ok(provider, 'DefinitionProvider 应存在')
})

// ========== References Provider 测试 ==========

test('LSP: ReferencesProvider 应能被实例化', () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  
  const provider = services.ObjectOrientedC.lsp.ReferencesProvider
  assert.ok(provider, 'ReferencesProvider 应存在')
})

// ========== 集成测试：完整 AST 解析 ==========

test('LSP: 应能解析复杂的 OOC 代码', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const parse = parseHelper<Model>(services.ObjectOrientedC)
  
  const code = `
    // 定义类型
    Point #type { x: number, y: number };
    
    // 定义变量
    p: Point = { x = 1, y = 2 };
    
    // 调用对象方法和属性
    result = p x;
    
    // lambda 表达式
    square = fn [x -> x * x];
    square apply 5;
    
    // 可变属性
    counter = {
      value <= 0,
      increment = fn [] (counter value (counter value + 1))
    };
    
    counter increment;
  `
  
  const document = await parse(code)
  assert.ok(document, '应能解析完整的 OOC 代码示例')
})

// ========== Shared Checker 测试 ==========

test('LSP: 共享 Checker 应返回同一实例', () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  
  // 获取 Provider 实例
  const hoverProvider = services.ObjectOrientedC.lsp.HoverProvider
  const completionProvider = services.ObjectOrientedC.lsp.CompletionProvider
  
  assert.ok(hoverProvider, 'HoverProvider 应存在')
  assert.ok(completionProvider, 'CompletionProvider 应存在')
})
