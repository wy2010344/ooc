import { beforeAll, describe, expect, test } from './compat.js'
import { EmptyFileSystem } from 'langium'
import { NodeFileSystem } from 'langium/node'
import * as nodeFs from 'node:fs/promises'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import {
  createInterpretAction,
  scanQuotedString,
  splitTemplate,
} from 'object-oriented-c-language'

let interpreter: ReturnType<typeof createInterpretAction>
let fileInterpreter: ReturnType<typeof createInterpretAction>

beforeAll(async () => {
  interpreter = createInterpretAction(EmptyFileSystem)
  fileInterpreter = createInterpretAction(NodeFileSystem)
})

describe('模版字符串的词法边界', () => {
  test('洞内单引号不影响收尾位置', () => {
    const text = `x = 'cls \${v if '' 'hidden'}' + 'tail'`
    const start = text.indexOf("'")
    const end = scanQuotedString(text, start)
    // 返回的是收尾引号之后的位置
    expect(end).toBe(text.indexOf("' + 'tail'") + 1)
    expect(text.slice(start, end)).toBe(`'cls \${v if '' 'hidden'}'`)
  })

  test('嵌套模版按最外层收尾', () => {
    const text = `'A\${'b\${n}c'}D'`
    expect(scanQuotedString(text, 0)).toBe(text.length)
  })

  test('洞内行注释里的引号不算数', () => {
    const text = `'x\${v // 注释里的 ' 引号\n}y'`
    expect(scanQuotedString(text, 0)).toBe(text.length)
  })

  test('未闭合返回 -1', () => {
    expect(scanQuotedString(`'abc`, 0)).toBe(-1)
    expect(scanQuotedString(`'a\${b'`, 0)).toBe(-1)
    expect(scanQuotedString(`abc`, 0)).toBe(-1)
  })
})

describe('模版切段', () => {
  test('文本段与洞段', () => {
    expect(splitTemplate(`'a\${x}b'`)).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'hole', source: 'x', start: 3 },
      { kind: 'text', text: 'b' },
    ])
  })

  test('洞内单引号保留在洞源码里', () => {
    const segs = splitTemplate(`'\${v if '' 'hidden'}'`)
    const hole = segs.find((s) => s.kind === 'hole')
    expect(hole && hole.kind === 'hole' ? hole.source : '').toBe(
      `v if '' 'hidden'`,
    )
  })
})

describe('模版求值', () => {
  test('洞内可以直接写单引号分支', async () => {
    const expr = (v: boolean) =>
      `v = ${v ? 'true' : 'false'}; 'cls \${v if '' 'hidden'}'`
    expect(await interpreter.interpret(expr(true))).toBe('cls ')
    expect(await interpreter.interpret(expr(false))).toBe('cls hidden')
  })

  test('洞内嵌套模版', async () => {
    expect(await interpreter.interpret(`n = 'B'; 'A\${'b\${n}c'}D'`)).toBe(
      'AbBcD',
    )
  })

  test('按文件执行时同样要 graft（解释器不走 DocumentBuilder 的 Parsed 阶段）', async () => {
    const dir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'ooc-tpl-'))
    const file = nodePath.join(dir, 'tpl.ooc')
    await nodeFs.writeFile(file, `n = 2; 'x\${n * 3}y'`)
    expect(await fileInterpreter.interpretPath(file)).toBe('x6y')
  })
})
