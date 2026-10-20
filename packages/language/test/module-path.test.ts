// #import 路径解析测试：纯字符串逻辑（module-path.ts）
import { describe, expect, test } from './compat.js'
import { resolveModuleName } from 'object-oriented-c-language'

const ext = ['.ooc']

describe('resolveModuleName 相对路径', () => {
  test('相对路径以 fromPath 目录为基准', () => {
    expect(resolveModuleName('./math', '/proj/demo.ooc', ext)).toBe('/proj/math.ooc')
    expect(resolveModuleName('math', '/proj/demo.ooc', ext)).toBe('/proj/math.ooc')
  })
  test('无扩展名补默认扩展', () => {
    expect(resolveModuleName('./math', '/proj/demo.ooc', ext)).toBe('/proj/math.ooc')
  })
  test('.. 上跳目录', () => {
    expect(resolveModuleName('../lib/util', '/proj/src/demo.ooc', ext)).toBe('/proj/lib/util.ooc')
  })
  test('绝对路径在无 fromPath 目录时保持绝对', () => {
    // fromPath 为空（顶层入口场景）：绝对路径原样保留
    expect(resolveModuleName('/abs/foo', '', ext)).toBe('/abs/foo.ooc')
  })
  test('绝对路径在 fromPath 存在时按原实现拼接目录（既有语义）', () => {
    expect(resolveModuleName('/abs/foo', '/proj/demo.ooc', ext)).toBe('/proj/abs/foo.ooc')
  })
  test('Windows 盘符路径按相对路径语义处理', () => {
    // 顶层入口（无 fromPath 目录）时保持盘符路径本质
    expect(resolveModuleName('C:/foo.ooc', '', ext)).toBe('C:/foo.ooc')
  })
})
