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
 * 相对 fromPath 所在目录解析 #import 路径：统一 posix；无扩展名补默认扩展
 * （Langium 按扩展名注册语言服务）。
 */
export function resolveModuleName(
  rawName: string,
  fromPath: string,
  extensions: readonly string[],
): string {
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