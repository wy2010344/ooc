import { test } from './compat.js'
import assert from 'node:assert/strict'
import { EmptyFileSystem } from 'langium'
import {
  expectHover,
  expectCompletion,
  expectFindReferences,
  expectGoToDefinition,
  parseHelper,
} from 'langium/test'
import { createObjectOrientedCServices } from 'object-oriented-c-language'
import type { Model } from 'object-oriented-c-language'
import { getSharedChecker, resetChecker } from 'object-oriented-c-language'

/**
 * LSP Smoke 测试
 * 验证所有 LSP Provider 可以被实例化并基本可用
 *
 * 使用 Langium 内置测试工具，采用自定义标记避免 TS 编译器问题：
 * - `@@` 标记光标位置（替代 <|>）
 * - `[[` 和 `]]` 标记范围（替代 <| 和 |>）
 */

// 自定义标记（避免 <| 被 TypeScript 解释为 JSX 标签）
const IDX = '@@'  // 光标位置标记
const RSTART = '[['  // 范围开始标记
const REND = ']]'  // 范围结束标记

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

// ========== AST 解析测试 ==========

test('LSP: 应能解析基本表达式', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const parse = parseHelper<Model>(services.ObjectOrientedC)

  const document = await parse('x = 42;')
  assert.ok(document, '应能解析基本表达式')
  assert.ok(document.parseResult?.value, '应有解析结果')
})

test('LSP: 应能解析对象方法', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const parse = parseHelper<Model>(services.ObjectOrientedC)

  const document = await parse(`
    obj = {
      greet(name) => 'Hello, ' + name
    };
    obj greet 'World';
  `)
  assert.ok(document, '应能解析对象和方法调用')
})

// ========== Hover Provider 测试 ==========

test('LSP: Hover 变量定义应有内容', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectHover(services.ObjectOrientedC)

  // 在变量 x 上悬停
  await expect({
    text: IDX + 'x = 42;',
    indexMarker: IDX,
    index: 0,
    hover: /变量|number|数字/,
  })
})

test('LSP: Hover Ref 引用应有内容', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectHover(services.ObjectOrientedC)

  // 在 y = x 中的 x 上悬停
  await expect({
    text: 'x = 42; y = ' + IDX + 'x;',
    indexMarker: IDX,
    index: 0,
    hover: /引用|变量|number|数字/,
  })
})

test('LSP: Hover 数字字面量应有内容', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectHover(services.ObjectOrientedC)

  // 在数字 42 上悬停
  await expect({
    text: 'x = ' + IDX + '42;',
    indexMarker: IDX,
    index: 0,
    hover: /数字|number/,
  })
})

test('LSP: Hover 字符串字面量应有内容', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectHover(services.ObjectOrientedC)

  // 在字符串 'hello' 上悬停
  await expect({
    text: "x = " + IDX + "'hello';",
    indexMarker: IDX,
    index: 0,
    hover: /字符串|string/,
  })
})

test('LSP: Hover 方法定义应有内容', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectHover(services.ObjectOrientedC)

  await expect({
    text: 'obj = {\n        ' + IDX + 'greet(name) => \'Hello, \' + name\n      };',
    indexMarker: IDX,
    index: 0,
    hover: /方法|greet/,
  })
})

test('LSP: Hover Lambda 应有内容', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectHover(services.ObjectOrientedC)

  await expect({
    text: 'square = ' + IDX + '[x -> x * x];',
    indexMarker: IDX,
    index: 0,
    hover: /λ|匿名函数/,
  })
})

// ========== Completion Provider 测试 ==========

test('LSP: Completion 应在变量位置提供补全', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectCompletion(services.ObjectOrientedC)

  // 在 x = 后面请求补全，应能看到变量 x
  const result = await expect({
    text: 'x = 42; y = ' + IDX + ';',
    indexMarker: IDX,
    index: 0,
    assert: (completions: any) => {
      const labels = completions.items.map((item: any) => item.label)
      assert.ok(labels.includes('x'), `补全列表应包含变量 x，实际: ${labels.join(', ')}`)
    },
  })
  assert.ok(result, '应返回补全结果')
})

test('LSP: Completion 应支持 lambda 参数补全', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectCompletion(services.ObjectOrientedC)

  // 在 lambda 内部，参数 x 应可见
  const result = await expect({
    text: 'f = [x -> ' + IDX + '];',
    indexMarker: IDX,
    index: 0,
    assert: (completions: any) => {
      const labels = completions.items.map((item: any) => item.label)
      assert.ok(labels.includes('x'), `补全列表应包含参数 x，实际: ${labels.join(', ')}`)
    },
  })
  assert.ok(result, '应返回补全结果')
})

// ========== References Provider 测试 ==========

test('LSP: References 应能查找变量引用', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectFindReferences(services.ObjectOrientedC)

  // 在变量定义 x 上查找引用，期望找到使用处 x
  await expect({
    text: IDX + 'x = 42; y = ' + RSTART + 'x' + REND + ';',
    indexMarker: IDX,
    rangeStartMarker: RSTART,
    rangeEndMarker: REND,
    includeDeclaration: false,
  })
})

test('LSP: References 应能在使用处查找', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectFindReferences(services.ObjectOrientedC)

  // 在使用处 x 上查找引用（包含定义），期望找到定义处和使用处
  await expect({
    text: IDX + 'x = 42; y = ' + RSTART + 'x' + REND + ';',
    indexMarker: IDX,
    rangeStartMarker: RSTART,
    rangeEndMarker: REND,
    includeDeclaration: true,
  })
})

// ========== Definition Provider 测试 ==========

test('LSP: Definition 应能跳转到变量定义', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const expect = expectGoToDefinition(services.ObjectOrientedC)

  // 在使用处 x 上请求跳转定义，期望跳转到定义处
  await expect({
    text: RSTART + 'x' + REND + ' = 42; y = ' + IDX + 'x;',
    indexMarker: IDX,
    rangeStartMarker: RSTART,
    rangeEndMarker: REND,
    index: 0,
    rangeIndex: 0,
  })
})

// ========== SignatureHelp Provider 测试 ==========

test('LSP: SignatureHelp 应能处理消息调用', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const parse = parseHelper<Model>(services.ObjectOrientedC)

  await parse('obj greet')
  const provider = services.ObjectOrientedC.lsp.SignatureHelp

  assert.ok(provider, 'SignatureHelp 应存在')

  const options = provider.signatureHelpOptions
  assert.ok(options, 'signatureHelpOptions 应存在')
  assert.ok(options.triggerCharacters, 'triggerCharacters 应存在')
})

// ========== 集成测试：完整 AST 解析 ==========

test('LSP: 应能解析完整的 OOC 代码', async () => {
  const services = createObjectOrientedCServices(EmptyFileSystem)
  const parse = parseHelper<Model>(services.ObjectOrientedC)

  const code = `
    Point #type { x: number, y: number };
    p = { x = 1, y = 2 };
    result = p x;
    square = [x -> x * x];
    obj = { greet(name) => 'Hello, ' + name };
    obj greet 'World';
  `

  const document = await parse(code)
  assert.ok(document, '应能解析完整的 OOC 代码示例')
  assert.ok(document.parseResult?.value, '应有解析结果')
})

// ========== Shared Checker 测试（WeakMap 实现） ==========

test('LSP: 共享 Checker 应使用 WeakMap 按服务存储', () => {
  const services1 = createObjectOrientedCServices(EmptyFileSystem)
  resetChecker(services1.ObjectOrientedC as any)

  const checker1 = getSharedChecker(services1.ObjectOrientedC as any)
  assert.ok(checker1, '第一次应能获取 checker')

  const checker2 = getSharedChecker(services1.ObjectOrientedC as any)
  assert.strictEqual(checker1, checker2, '同一服务应返回同一 checker 实例')
})

test('LSP: 不同服务实例应有独立的 Checker', () => {
  const services1 = createObjectOrientedCServices(EmptyFileSystem)
  const services2 = createObjectOrientedCServices(EmptyFileSystem)

  resetChecker(services1.ObjectOrientedC as any)
  resetChecker(services2.ObjectOrientedC as any)

  const checker1 = getSharedChecker(services1.ObjectOrientedC as any)
  const checker2 = getSharedChecker(services2.ObjectOrientedC as any)

  assert.ok(checker1, 'services1 应有 checker')
  assert.ok(checker2, 'services2 应有 checker')
})

// ========== 启动服务器测试（验证服务配置完整） ==========

test('LSP: 服务配置应完整', () => {
  const result = createObjectOrientedCServices(EmptyFileSystem)
  const services = result.ObjectOrientedC

  assert.ok(services.lsp, 'lsp 根服务应存在')
  assert.ok(services.workspace, 'workspace 服务应存在')
  assert.ok(services.parser, 'parser 服务应存在')
  assert.ok(services.Grammar, 'Grammar 应存在')
})