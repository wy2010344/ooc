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
export function dirnameOf(fileName: string): string {
  const posix = toPosix(fileName)
  const i = posix.lastIndexOf('/')
  return i > -1 ? posix.slice(0, i) : ''
}
export function joinPath(dir: string, rel: string): string {
  const parts: string[] = []
  for (const seg of `${dir ? dir + '/' : ''}${rel}`.split('/')) {
    if (seg === '..') {
      parts.pop()
    } else if (seg !== '.' && seg !== '') {
      parts.push(seg)
    }
  }
  return parts.join('/')
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
  if (extnameOf(fileName) === '') {
    fileName += extensions[0]
  }
  return fileName
}
