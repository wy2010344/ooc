import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { installPackage, readPackageManifest } from 'object-oriented-c-cli'

// 建一个临时包根，返回其路径
async function makePkgRoot(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-pkg-'))
  await fs.mkdir(path.join(root, 'sub'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf-8')
  }
  return root
}

test('readPackageManifest 读取 ooc.json 包名', async () => {
  const root = await makePkgRoot('demo', {
    'ooc.json': JSON.stringify({ name: 'demo', version: '0.1.0' }),
  })
  const manifest = await readPackageManifest(root)
  if (manifest?.name !== 'demo') {
    throw new Error(`期望包名 demo，实际 ${manifest?.name}`)
  }
})

test('本地目录安装：按 ooc.json name 拷贝 .ooc 与 ooc.json', async () => {
  const pkgRoot = await makePkgRoot('base', {
    'ooc.json': JSON.stringify({ name: 'base' }),
    'index.ooc': `{ loop = #import 'loop' }`,
    'loop.ooc': `loop = { apply = fn => fn() }`,
  })
  const modulesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-modules-'))
  const result = await installPackage(pkgRoot, modulesRoot)

  if (result.name !== 'base') {
    throw new Error(`期望包名 base，实际 ${result.name}`)
  }
  // 安装目录里出现包源码与清单
  for (const rel of ['index.ooc', 'loop.ooc', 'ooc.json']) {
    const target = path.join(modulesRoot, 'base', rel)
    const stat = await fs.stat(target)
    if (!stat.isFile()) throw new Error(`缺失 ${rel}`)
  }
  // 非 OOC 文件不应被拷贝（node_modules 被跳过）
  const skipped = path.join(modulesRoot, 'base', 'node_modules')
  const skipStat = await fs.stat(skipped).catch(() => undefined)
  if (skipStat) throw new Error('node_modules 不应被拷贝')
})

test('ooc.json 缺失时用目录名作为包名', async () => {
  const pkgRoot = await makePkgRoot('fallback-pkg', {
    'loop.ooc': `loop = { }`,
  })
  const modulesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-modules-'))
  const result = await installPackage(pkgRoot, modulesRoot)
  const dirName = path.basename(pkgRoot)
  if (result.name !== dirName) {
    throw new Error(`期望目录名兜底 ${dirName}，实际 ${result.name}`)
  }
})