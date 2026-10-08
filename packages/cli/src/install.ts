// ooc install：把 OOC 包安装到 <cwd>/.ooc_modules/<name>/。
// 来源可以是本地包根目录或 git 仓库 URL（git clone --depth 1）。
// 包名取包根 ooc.json 的 name 字段，缺省回退目录名。
import * as nodeFs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const MODULES_DIR_NAME = '.ooc_modules'
/** 拷贝时跳过的目录（避免把工具链产物拖进包） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', MODULES_DIR_NAME])

/** 包根清单 ooc.json：name 决定 .ooc_modules/<name>/ 目录名 */
export type OocPackageManifest = { name?: string; version?: string }

/**
 * 读取包根下的 ooc.json；文件缺失或解析失败返回 undefined（用目录名兜底）。
 */
export async function readPackageManifest(
  pkgRoot: string,
): Promise<OocPackageManifest | undefined> {
  try {
    const raw = await fsp.readFile(path.join(pkgRoot, 'ooc.json'), 'utf-8')
    return JSON.parse(raw) as OocPackageManifest
  } catch {
    return undefined
  }
}

/** 递归拷贝目录内容到目标（跳过 SKIP_DIRS） */
async function copyTree(src: string, dest: string): Promise<void> {
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await fsp.mkdir(to, { recursive: true })
      await copyTree(from, to)
    } else {
      // 只拷贝 OOC 相关文件：.ooc 源码与 ooc.json 清单
      if (entry.name.endsWith('.ooc') || entry.name === 'ooc.json') {
        await fsp.copyFile(from, to)
      }
    }
  }
}

/** 从 git 仓库根向下找含 ooc.json 的目录（限深度 3，赶不上就用根） */
async function findPackageRoot(root: string, depth = 0): Promise<string> {
  if (depth > 3) return root
  if (nodeFs.existsSync(path.join(root, 'ooc.json'))) return root
  const entries = await fsp.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue
    }
    const found = await findPackageRoot(path.join(root, entry.name), depth + 1)
    if (nodeFs.existsSync(path.join(found, 'ooc.json'))) return found
  }
  return root
}

/** http(s)/ssh 形式的 git URL 判定（本地路径不走 clone） */
function isGitUrl(source: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(source)
}

function gitRepoName(source: string): string {
  const base = source.replace(/\.git$/, '')
  const seg = base.split(/[/:]/).filter(Boolean).pop()
  return seg ?? 'pkg'
}

export type InstallResult = {
  name: string
  destDir: string
  fileCount: number
}

/**
 * 安装包：本地目录直接拷贝包根；git URL 先 clone 到临时目录再找包根。
 * 返回安装后的包名与目标目录，便于上层打印。
 */
export async function installPackage(
  source: string,
  modulesRoot: string,
): Promise<InstallResult> {
  await fsp.mkdir(modulesRoot, { recursive: true })
  if (!nodeFs.existsSync(source) && !isGitUrl(source)) {
    throw new Error(`安装源不存在: ${source}`)
  }

  let pkgRoot = source
  let tmpDir: string | undefined
  if (isGitUrl(source)) {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ooc-install-'))
    await execFileAsync('git', ['clone', '--depth', '1', source, tmpDir])
    pkgRoot = await findPackageRoot(tmpDir)
  }

  const manifest = await readPackageManifest(pkgRoot)
  const name = manifest?.name ?? path.basename(isGitUrl(source) ? gitRepoName(source) : source)
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`非法包名: ${name ?? ''}（请检查包根 ooc.json 的 name 字段）`)
  }
  if (!nodeFs.existsSync(pkgRoot) || !nodeFs.statSync(pkgRoot).isDirectory()) {
    throw new Error(`包根不存在或不是目录: ${pkgRoot}`)
  }

  const destDir = path.join(modulesRoot, name)
  const before = countOocFiles(pkgRoot)
  await fsp.rm(destDir, { recursive: true, force: true })
  await fsp.mkdir(destDir, { recursive: true })
  await copyTree(pkgRoot, destDir)

  if (tmpDir) {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
  return { name, destDir, fileCount: before }
}

/** 递归统计包根下将被拷贝的 .ooc/ooc.json 文件数 */
function countOocFiles(root: string): number {
  const entries = nodeFs.readdirSync(root, { withFileTypes: true })
  let n = 0
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      n += countOocFiles(path.join(root, entry.name))
    } else if (entry.name.endsWith('.ooc') || entry.name === 'ooc.json') {
      n += 1
    }
  }
  return n
}