// 生成物严格类型回归：现有 tsgen 测试只跑 Node 类型擦除，这里额外让 tsc
// 以 strict + verbatimModuleSyntax + erasableSyntaxOnly 检查产物。
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { compileAction } from 'object-oriented-c-cli'

const require = createRequire(import.meta.url)
const tscPath = require.resolve('typescript/bin/tsc')

function checkWithTsc(file: string): void {
  execFileSync(
    process.execPath,
    [
      tscPath,
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'ESNext',
      '--moduleResolution',
      'bundler',
      '--allowImportingTsExtensions',
      '--skipLibCheck',
      '--verbatimModuleSyntax',
      '--isolatedModules',
      '--erasableSyntaxOnly',
      file,
    ],
    { stdio: 'pipe' },
  )
}

test('生成物在 strict tsc 下通过：nil / this / rest / 泛型 / as / export type', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsc-'))
  await fs.writeFile(
    path.join(dir, 'helper.ts'),
    `export type Foo = { hi(): string }
export const tag = 'ts-module'
export default { tag }
`,
    'utf-8',
  )
  const src = `#import './helper.ts' { Foo };

Shape #type {
  'foo-bar': number,
  size: number | nil,
  g(...xs: number): number,
  h(x): string,
  map<T>(x: T): T
};

x: Foo = { hi = 'ok' };

obj = {
  map<T>(v: T): T { v },
  sum(...xs: number): number { xs length },
  f <= @{ this },
  m(a) {
    t = a #as number;
    u = nil;
    #guard a > 0;
      z = a + 1;
      z
    #else;
      z = a - 1;
      z
  },
  lam => [v => this]
};

selfLambda = [selfLambda];
selfObject = { get { selfObject } };

{ foo = x, value = (obj m 3), lambda = (obj lam) }
`
  const srcPath = path.join(dir, 'main.ooc')
  await fs.writeFile(srcPath, src, 'utf-8')
  await compileAction(srcPath, { destination: dir })
  const code = await fs.readFile(path.join(dir, 'main.ts'), 'utf-8')
  if (!/export type \{ Foo \}/.test(code)) {
    throw new Error(`类型导入再导出应为 export type，实际：\n${code}`)
  }
  if (!/export type Shape = \{/.test(code) || !/['"]foo-bar['"]: number/.test(code)) {
    throw new Error(`#type 产物不合法，实际：\n${code}`)
  }
  checkWithTsc(path.join(dir, 'main.ts'))
})
