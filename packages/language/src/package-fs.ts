// 包感知的 FileSystemProvider：把包引用虚拟路径（/ooc-pkg/<pkg>/<file>）重定向到
// 实际存储位置，其余路径原样转发给底层 FS。
// - Node/CLI：重定向到 <cwd>/.ooc_modules/<pkg>/<file>（真实目录）
// - 浏览器：现有浏览器 FS 直接按 Uri 分配源码，通常不需要本包装
import { type FileSystemProvider, URI } from 'langium'
import { PACKAGE_URI_PREFIX } from './module-path.js'

/** 包解析器：把包名解析到它的源码根目录（posix 绝对路径）。 */
export interface PackageRootResolver {
  rootOf(pkg: string): string | undefined
}

/** 从包根目录 <dir> 把 /ooc-pkg/<pkg>/<file> 映射到 <dir>/<pkg>/<file>。 */
export function createDirPackageResolver(dir: string): PackageRootResolver {
  return {
    rootOf(pkg: string): string | undefined {
      if (!pkg || pkg.includes('..')) {
        return undefined
      }
      return `${dir}/${pkg}`
    },
  }
}

/** 把虚拟包路径 uri.path 解析为真实文件路径；非包路径原样返回。 */
export function mapPackagePath(
  uriPath: string,
  resolvePackage: PackageRootResolver,
): string {
  const prefix = PACKAGE_URI_PREFIX + '/'
  if (uriPath.startsWith(prefix)) {
    const rest = uriPath.slice(prefix.length)
    const slash = rest.indexOf('/')
    const pkg = slash === -1 ? rest : rest.slice(0, slash)
    const root = resolvePackage.rootOf(pkg)
    if (root) {
      const sub = slash === -1 ? '' : rest.slice(slash + 1)
      const dir = root.replace(/\/+$/, '')
      return sub ? `${dir}/${sub}` : dir
    }
  }
  return uriPath
}

function withMappedPath(
  uri: URI,
  resolvePackage: PackageRootResolver,
): URI {
  const mapped = mapPackagePath(uri.path, resolvePackage)
  if (mapped === uri.path) {
    return uri
  }
  // 返回 path 已替换的等价 Uri：file 走 URI.file（fsPath 按真实文件系统解析）
  return URI.file(mapped)
}

/**
 * 包感知包装：所有方法先把 uri 按 package 解析器映射，再转发给底层 fs。
 * 底层可以是 Langium 的 NodeFileSystem（真实文件）或任何自定义 provider。
 */
export function createPackageAwareFileSystem(
  fs: FileSystemProvider,
  resolvePackage: PackageRootResolver,
): FileSystemProvider {
  const map = (uri: URI) => withMappedPath(uri, resolvePackage)
  return {
    stat: (uri) => fs.stat(map(uri)),
    statSync: (uri) => fs.statSync(map(uri)),
    exists: (uri) => fs.exists(map(uri)),
    existsSync: (uri) => fs.existsSync(map(uri)),
    readBinary: (uri) => fs.readBinary(map(uri)),
    readBinarySync: (uri) => fs.readBinarySync(map(uri)),
    readFile: (uri) => fs.readFile(map(uri)),
    readFileSync: (uri) => fs.readFileSync(map(uri)),
    readDirectory: (uri) => fs.readDirectory(map(uri)),
    readDirectorySync: (uri) => fs.readDirectorySync(map(uri)),
  }
}