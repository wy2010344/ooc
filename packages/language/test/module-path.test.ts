// #import 路径解析与包引用测试：纯字符串逻辑（module-path.ts）
import { describe, expect, test } from './compat.js'
import {
  PACKAGE_URI_PREFIX,
  createDirPackageResolver,
  createPackageAwareFileSystem,
  isPackageRef,
  mapPackagePath,
  resolveModuleName,
  resolvePackageModule,
} from 'object-oriented-c-language'
import type { FileSystemProvider, URI } from 'langium'

const ext = ['.ooc']

describe('resolveModuleName 相对路径（不变行为）', () => {
  test('相对路径以 fromPath 目录为基准', () => {
    expect(resolveModuleName('./math', '/proj/demo.ooc', ext)).toBe('/proj/math.ooc')
    expect(resolveModuleName('math', '/proj/demo.ooc', ext)).toBe('/proj/math.ooc')
  })
  test('无扩展名补默认扩展', () => {
    expect(resolveModuleName('./math', '/proj/demo.ooc', ext)).toBe('/proj/math.ooc')
  })
  test('.. 上跳目录', () => {
    expect(resolveModuleName('../lib/util', '/proj/src/demo.ooc', ext)).toBe('/proj/lib/util.ooc')
  })
  test('绝对路径在无 fromPath 目录时保持绝对', () => {
    // fromPath 为空（顶层入口场景）：绝对路径原样保留
    expect(resolveModuleName('/abs/foo', '', ext)).toBe('/abs/foo.ooc')
  })
  test('绝对路径在 fromPath 存在时按原实现拼接目录（既有语义）', () => {
    expect(resolveModuleName('/abs/foo', '/proj/demo.ooc', ext)).toBe('/proj/abs/foo.ooc')
  })
  test('裸名不带 @ 不是包引用', () => {
    expect(isPackageRef('loop')).toBe(false)
    expect(isPackageRef('./loop')).toBe(false)
    expect(isPackageRef('../loop')).toBe(false)
  })
})

describe('包引用 resolvePackageModule', () => {
  test('@pkg 默认入口 index.ooc', () => {
    expect(isPackageRef('@base')).toBe(true)
    expect(resolvePackageModule('@base', ext)).toBe(`${PACKAGE_URI_PREFIX}/base/index.ooc`)
  })
  test('@pkg/sub 补扩展名', () => {
    expect(resolvePackageModule('@base/loop', ext)).toBe(`${PACKAGE_URI_PREFIX}/base/loop.ooc`)
  })
  test('@pkg/a/b 保留子目录', () => {
    expect(resolvePackageModule('@base/util/math', ext)).toBe(`${PACKAGE_URI_PREFIX}/base/util/math.ooc`)
  })
  test('带扩展名不重复补', () => {
    expect(resolvePackageModule('@base/loop.ooc', ext)).toBe(`${PACKAGE_URI_PREFIX}/base/loop.ooc`)
  })
  test('@a/b 一律视为包 a 的子模块 b（不支持 npm scoped 命名空间）', () => {
    expect(resolvePackageModule('@scope/loop', ext)).toBe(`${PACKAGE_URI_PREFIX}/scope/loop.ooc`)
  })
  test('resolveModuleName 走包引用分支', () => {
    expect(resolveModuleName('@base', '/proj/demo.ooc', ext)).toBe(
      `${PACKAGE_URI_PREFIX}/base/index.ooc`,
    )
    expect(resolveModuleName('@base/loop', '/proj/demo.ooc', ext)).toBe(
      `${PACKAGE_URI_PREFIX}/base/loop.ooc`,
    )
  })
  test('Windows 盘符不被识别为包引用，按既有相对路径语义处理', () => {
    expect(isPackageRef('C:/foo.ooc')).toBe(false)
    // 顶层入口（无 fromPath 目录）时保持盘符路径本质
    expect(resolveModuleName('C:/foo.ooc', '', ext)).toBe('C:/foo.ooc')
  })
})

describe('包感知 FileSystemProvider（重定向 /ooc-pkg → 包根目录）', () => {
  const resolver = createDirPackageResolver('/repo/.ooc_modules')

  test('mapPackagePath 映射包路径', () => {
    expect(mapPackagePath('/ooc-pkg/base/loop.ooc', resolver)).toBe(
      '/repo/.ooc_modules/base/loop.ooc',
    )
    expect(mapPackagePath('/ooc-pkg/base/index.ooc', resolver)).toBe(
      '/repo/.ooc_modules/base/index.ooc',
    )
  })

  test('非包路径原样返回', () => {
    expect(mapPackagePath('/proj/math.ooc', resolver)).toBe('/proj/math.ooc')
    expect(mapPackagePath('/ooc/pkgs/x', resolver)).toBe('/ooc/pkgs/x')
  })

  test('包名含 .. 拒绝映射（原样返回，交给底层报错）', () => {
    expect(mapPackagePath('/ooc-pkg/../evil/file.ooc', resolver)).toBe(
      '/ooc-pkg/../evil/file.ooc',
    )
  })

  test('包装 provider 转发读取到映射后的真实 URI', async () => {
    // 底层内存 FS 以完整路径为键
    const files = new Map<string, string>([
      ['/repo/.ooc_modules/base/loop.ooc', 'loop = { apply(fn) => nil }; loop'],
      ['/proj/math.ooc', 'x = 42; x'],
    ])
    const nameOf = (uri: URI) => decodeURIComponent(uri.path)
    const underlying: FileSystemProvider = {
      stat(uri) {
        if (files.has(nameOf(uri))) {
          return Promise.resolve({ isFile: true, isDirectory: false, uri })
        }
        return Promise.reject(new Error(`文件不存在: ${uri.path}`))
      },
      statSync(uri) {
        if (files.has(nameOf(uri))) {
          return { isFile: true, isDirectory: false, uri }
        }
        throw new Error(`文件不存在: ${uri.path}`)
      },
      exists(uri) {
        return Promise.resolve(files.has(nameOf(uri)))
      },
      existsSync(uri) {
        return files.has(nameOf(uri))
      },
      readBinary() {
        return Promise.resolve(new Uint8Array())
      },
      readBinarySync() {
        return new Uint8Array()
      },
      readFile(uri) {
        const c = files.get(nameOf(uri))
        if (c == null) {
          return Promise.reject(new Error(`文件不存在: ${uri.path}`))
        }
        return Promise.resolve(c)
      },
      readFileSync(uri) {
        const c = files.get(nameOf(uri))
        if (c == null) {
          throw new Error(`文件不存在: ${uri.path}`)
        }
        return c
      },
      readDirectory() {
        return Promise.resolve([])
      },
      readDirectorySync() {
        return []
      },
    }

    const wrapped = createPackageAwareFileSystem(underlying, resolver)
    const pkgUri = { path: '/ooc-pkg/base/loop.ooc' } as unknown as URI
    const projUri = { path: '/proj/math.ooc' } as unknown as URI
    expect(await wrapped.exists(pkgUri)).toBe(true)
    expect(await wrapped.readFile(pkgUri)).toBe(files.get('/repo/.ooc_modules/base/loop.ooc'))
    expect(await wrapped.exists(projUri)).toBe(true)
    expect(await wrapped.readFile(projUri)).toBe('x = 42; x')
  })
})