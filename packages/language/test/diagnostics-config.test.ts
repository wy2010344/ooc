import { describe, expect, test } from './compat.js'
import { URI } from 'langium'
import { parseHelper } from 'langium/test'
import { DiagnosticSeverity } from 'vscode-languageserver-types'
import type { OocConfig } from 'object-oriented-c-language'
import { createObjectOrientedCServices } from 'object-oriented-c-language'
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

  test('带 UTF-8 BOM 的内容也能解析', () => {
    const config = parseOocConfig(
      '\uFEFF' + JSON.stringify({ diagnostics: { typeMismatch: 'error' } }),
    )
    expect(config.diagnostics).toEqual({ typeMismatch: 'error' })
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

describe('filterDiagnostic 默认级别（类 TS noImplicitAny）', () => {
  test('noImplicitAny 未显式配置时默认 off（有配置对象）', () => {
    expect(filterDiagnostic({}, 'warning', 'noImplicitAny')).toBeUndefined()
    expect(filterDiagnostic({}, 2, 'noImplicitAny')).toBeUndefined()
    expect(
      filterDiagnostic(
        { diagnostics: { unknownType: 'off' } },
        2,
        'noImplicitAny',
      ),
    ).toBeUndefined()
  })

  test('noImplicitAny 未读取配置（undefined）时原样放行', () => {
    expect(filterDiagnostic(undefined, 'warning', 'noImplicitAny')).toBe(
      'warning',
    )
    expect(filterDiagnostic(undefined, 2, 'noImplicitAny')).toBe(2)
  })

  test('noImplicitAny 显式配置为 warning/error 时生效', () => {
    expect(
      filterDiagnostic({ diagnostics: { noImplicitAny: 'warning' } }, 2, 'noImplicitAny'),
    ).toBe(2)
    expect(
      filterDiagnostic({ diagnostics: { noImplicitAny: 'error' } }, 2, 'noImplicitAny'),
    ).toBe(1)
  })

  test('其他 code 未配置时仍保持原 severity', () => {
    expect(filterDiagnostic({}, 2, 'typeMismatch')).toBe(2)
    expect(filterDiagnostic({}, 1, 'typeMismatch')).toBe(1)
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

  test("rootPath 为 '/' 时 URI 拼接正确（不产生 //ooc.json）", async () => {
    let seenPath = ''
    const fs = {
      exists: async (uri: URI) => {
        seenPath = uri.path
        return false
      },
      readFile: async () => '',
    }
    expect(await loadOocConfig(fs, '/')).toEqual({})
    expect(seenPath).toBe('/ooc.json')
  })
})

describe('ConfigAwareDocumentValidator 升降级', () => {
  function fsWithSources(sources: Record<string, string>) {
    const nameOf = (uri: URI) =>
      decodeURIComponent(uri.path).split('/').filter(Boolean).pop() ?? ''
    return {
      stat(uri: URI) {
        return Promise.resolve({ isFile: true, isDirectory: false, uri })
      },
      statSync(uri: URI) {
        return { isFile: true, isDirectory: false, uri }
      },
      exists(uri: URI) {
        return Promise.resolve(nameOf(uri).toLowerCase() in sources)
      },
      existsSync(uri: URI) {
        return nameOf(uri).toLowerCase() in sources
      },
      async readBinary() {
        return new Uint8Array()
      },
      readBinarySync() {
        return new Uint8Array()
      },
      readFile(uri: URI) {
        const key = nameOf(uri).toLowerCase()
        const source = sources[key]
        if (source == null) {
          throw new Error(`模块不存在: ${uri.path}`)
        }
        return Promise.resolve(source)
      },
      readFileSync() {
        throw new Error('不支持同步读文件')
      },
      readDirectory() {
        return Promise.resolve([])
      },
      readDirectorySync() {
        return []
      },
    }
  }

  test("ooc.json 中 typeMismatch:'error' 将诊断提升为错误", async () => {
    const services = createObjectOrientedCServices({
      fileSystemProvider: () =>
        fsWithSources({
          'ooc.json': JSON.stringify({
            diagnostics: { typeMismatch: 'error' },
          }),
        }),
    })
    const parse = parseHelper(services.ObjectOrientedC)
    const doc = await parse(`x: number = 'hello'`, {
      documentUri: URI.file('/proj/demo.ooc').toString(),
      validation: true,
    })
    const mismatch = (doc.diagnostics ?? []).find((d) =>
      d.message.includes('类型不匹配'),
    )
    expect(mismatch?.severity).toBe(DiagnosticSeverity.Error)
  })

  test("ooc.json 中 unknownType:'off' 隐藏诊断", async () => {
    const services = createObjectOrientedCServices({
      fileSystemProvider: () =>
        fsWithSources({
          'ooc.json': JSON.stringify({
            diagnostics: { unknownType: 'off' },
          }),
        }),
    })
    const parse = parseHelper(services.ObjectOrientedC)
    const doc = await parse(`x: Foo = 33`, {
      documentUri: URI.file('/proj/demo.ooc').toString(),
      validation: true,
    })
    expect(doc.diagnostics ?? []).toEqual([])
  })

  test("noImplicitAny 未配置时默认 off，无诊断", async () => {
    const services = createObjectOrientedCServices({
      fileSystemProvider: () => fsWithSources({}),
    })
    const parse = parseHelper(services.ObjectOrientedC)
    const doc = await parse(`calc = { add(n) { n + 1 } }`, {
      documentUri: URI.file('/proj/demo.ooc').toString(),
      validation: true,
    })
    expect(doc.diagnostics ?? []).toEqual([])
  })

  test("ooc.json 中 noImplicitAny:'error' 将隐式 any 参数提升为错误", async () => {
    const services = createObjectOrientedCServices({
      fileSystemProvider: () =>
        fsWithSources({
          'ooc.json': JSON.stringify({
            diagnostics: { noImplicitAny: 'error' },
          }),
        }),
    })
    const parse = parseHelper(services.ObjectOrientedC)
    const doc = await parse(`calc = { add(n) { n + 1 } }`, {
      documentUri: URI.file('/proj/demo.ooc').toString(),
      validation: true,
    })
    const implicit = (doc.diagnostics ?? []).find(
      (d) => d.message.includes('隐式 any'),
    )
    expect(implicit?.severity).toBe(DiagnosticSeverity.Error)
  })
})
