import { describe, expect, test } from 'vitest'
import type { OocConfig } from 'object-oriented-c-language'
import {
  parseOocConfig,
  filterDiagnostic,
  codeOfDiagnostic,
  diagnosticData,
  loadOocConfig,
} from 'object-oriented-c-language'

describe('parseOocConfig', () => {
  test('解析合法的 diagnostics 字段', () => {
    const config = parseOocConfig(
      JSON.stringify({
        diagnostics: {
          unknownType: 'off',
          typeMismatch: 'warning',
          callArgsMismatch: 'error',
        },
      }),
    )
    expect(config.diagnostics).toEqual({
      unknownType: 'off',
      typeMismatch: 'warning',
      callArgsMismatch: 'error',
    })
  })

  test('非法级别被忽略', () => {
    const config = parseOocConfig(
      JSON.stringify({ diagnostics: { typeMismatch: 'fatal' as string } }),
    )
    expect(config.diagnostics).toEqual({})
  })

  test('空内容返回空配置', () => {
    expect(parseOocConfig('')).toEqual({})
    expect(parseOocConfig('not json')).toEqual({})
    expect(parseOocConfig(JSON.stringify({}))).toEqual({})
  })
})

describe('filterDiagnostic', () => {
  const config: OocConfig = {
    diagnostics: {
      unknownType: 'off',
      callArgsMismatch: 'error',
    },
  }

  test('未配置的 code 保持原 severity（数字）', () => {
    expect(filterDiagnostic(config, 2, 'typeMismatch')).toBe(2)
  })

  test('未配置的 code 保持原 severity（字符串）', () => {
    expect(filterDiagnostic(config, 'warning', 'typeMismatch')).toBe('warning')
  })

  test('无 code 时保持原 severity', () => {
    expect(filterDiagnostic(config, 2, undefined)).toBe(2)
  })

  test('off 返回 undefined 隐藏诊断', () => {
    expect(filterDiagnostic(config, 2, 'unknownType')).toBeUndefined()
  })

  test('error 提升为错误（数字 1）', () => {
    expect(filterDiagnostic(config, 2, 'callArgsMismatch')).toBe(1)
  })

  test('error 提升为错误（字符串）', () => {
    expect(filterDiagnostic(config, 'warning', 'callArgsMismatch')).toBe('error')
  })

  test('无配置对象时保持原 severity', () => {
    expect(filterDiagnostic(undefined, 2, 'unknownType')).toBe(2)
    expect(filterDiagnostic({}, 1, 'unknownType')).toBe(1)
  })
})

describe('codeOfDiagnostic / diagnosticData', () => {
  test('diagnosticData 挂 code，codeOfDiagnostic 可提取', () => {
    const data = diagnosticData('typeMismatch')
    expect(codeOfDiagnostic({ data })).toBe('typeMismatch')
  })

  test('无 data 或 data 无 code 返回 undefined', () => {
    expect(codeOfDiagnostic({})).toBeUndefined()
    expect(codeOfDiagnostic({ data: { x: 1 } })).toBeUndefined()
    expect(codeOfDiagnostic({ data: 'str' })).toBeUndefined()
  })
})

describe('loadOocConfig', () => {
  test('ooc.json 存在时读取并解析', async () => {
    const fs = {
      exists: async () => true,
      readFile: async () =>
        JSON.stringify({ diagnostics: { unknownType: 'off' } }),
    }
    const config = await loadOocConfig(fs, '/root')
    expect(config.diagnostics).toEqual({ unknownType: 'off' })
  })

  test('ooc.json 不存在返回空配置', async () => {
    const fs = { exists: async () => false, readFile: async () => '' }
    expect(await loadOocConfig(fs, '/root')).toEqual({})
  })

  test('读取出错返回空配置', async () => {
    const fs = {
      exists: async () => true,
      readFile: async () => {
        throw new Error('boom')
      },
    }
    expect(await loadOocConfig(fs, '/root')).toEqual({})
  })
})
