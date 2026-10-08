// 模块路径工具：纯字符串实现，Node 与浏览器行为一致（避免 node:path 依赖）。
// 静态类型（createImportResolver）与运行时（interpretPath）共用，保证 #import 解析一致。

export function toPosix(fileName: string): string {
  return fileName.replace(/\\/g, '/')
}
export function extnameOf(fileName: string): string {
  const base = toPosix(fileName).split('/').pop() ?? ''
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i) : ''
}
export function isAbsolutePath(p: string): boolean {
  const posix = toPosix(p)
  return posix.startsWith('/') || /^[A-Za-z]:\//.test(posix)
}
export function dirnameOf(fileName: string): string {
  const posix = toPosix(fileName)
  const i = posix.lastIndexOf('/')
  if (i === -1) return ''
  // 根目录文件：/main.ooc 的 dirname 是 '/' 而非 ''
  if (i === 0) return '/'
  return posix.slice(0, i)
}
export function joinPath(dir: string, rel: string): string {
  const parts: string[] = []
  const absolute = dir.startsWith('/')
  for (const seg of `${dir ? dir + '/' : ''}${rel}`.split('/')) {
    if (seg === '..') {
      parts.pop()
    } else if (seg !== '.' && seg !== '') {
      parts.push(seg)
    }
  }
  let result = parts.join('/')
  // 绝对路径保留前导 /
  if (absolute && result) result = '/' + result
  return result || (absolute ? '/' : '')
}

/**
 * 包引用虚拟根前缀：#import '@pkg' / '@pkg/sub' 解析为 /ooc-pkg/<pkg>/<file>，
 * 由宿主 FileSystemProvider 重定向到实际存储（Node 的 .ooc_modules、浏览器内存 map）。
 */
export const PACKAGE_URI_PREFIX = '/ooc-pkg'

/** #import 字符串是否包引用：以 @ 开头（Windows 盘符 C: 不以 @ 开头，不冲突）。 */
export function isPackageRef(rawName: string): boolean {
  return rawName.startsWith('@')
}

/**
 * 把包引用解析为统一虚拟路径。
 * - '@base'        → /ooc-pkg/base/index.ooc   （包入口默认 index.ooc）
 * - '@base/loop'   → /ooc-pkg/base/loop.ooc
 * - '@base/a/b'    → /ooc-pkg/base/a/b.ooc     （包子路径，保留子目录层级）
 * 子路径不带扩展名时按默认扩展名补全；带未知扩展名按原样返回，交给 FS 报错。
 */
export function resolvePackageModule(
  rawName: string,
  extensions: readonly string[],
): string {
  const rest = rawName.slice(1)
  const slash = rest.indexOf('/')
  const pkg = slash === -1 ? rest : rest.slice(0, slash)
  let sub = slash === -1 ? '' : rest.slice(slash + 1)
  if (!sub) {
    sub = 'index'
  }
  if (extnameOf(sub) === '') {
    sub += extensions[0]
  }
  return `${PACKAGE_URI_PREFIX}/${pkg}/${sub}`
}

/**
 * 相对 fromPath 所在目录解析 #import 路径：统一 posix；无扩展名补默认扩展
 * （Langium 按扩展名注册语言服务）。包引用（@ 开头）走 PACKAGE_URI_PREFIX 虚拟路径。
 */
export function resolveModuleName(
  rawName: string,
  fromPath: string,
  extensions: readonly string[],
): string {
  if (isPackageRef(rawName)) {
    return resolvePackageModule(rawName, extensions)
  }
  let fileName = joinPath(dirnameOf(fromPath), rawName)
  fileName = toPosix(fileName)
  // rawName 是绝对路径时，确保结果也保持绝对
  if (isAbsolutePath(rawName) && !isAbsolutePath(fileName)) {
    fileName = '/' + fileName
  }
  if (extnameOf(fileName) === '') {
    fileName += extensions[0]
  }
  return fileName
}