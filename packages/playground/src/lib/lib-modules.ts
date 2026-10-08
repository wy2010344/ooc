/**
 * 外部库模块预加载：
 * 使用 vite 的 import.meta.glob 预加载基础包（base / ooc-mve-bridge）的 .ooc 文件，
 * 供虚拟文件系统使用，让 OOC 代码可以通过 #import '@base/...' 包引用导入它们。
 *
 * 键 = 源码 basename 全名（含 .ooc，小写），与 engine 虚拟 FS 的 basename 查找一致：
 * '@base/loop' → /ooc-pkg/base/loop.ooc → basename 'loop.ooc'，命中即可。
 *
 * 注意：vite 的 import.meta.glob 不支持直接 npm 包路径，
 * 需要使用相对路径定位包内的 .ooc 文件。
 */

// 预加载 ooc-mve-bridge 包的 .ooc 文件（使用相对路径）
const oocMveBridgeModules = import.meta.glob(
  '../../../../ooc-mve-bridge/src/*.ooc',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
)

// 预加载 base 包的 .ooc 文件（标准库，使用相对路径）
const baseModules = import.meta.glob(
  '../../../../base/src/*.ooc',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
)

/** 外部库模块：basename 全名（含 .ooc，小写） → source */
export interface LibModules {
  [name: string]: string
}

/** 获取所有外部库模块 */
export function getLibModules(): LibModules {
  const modules: LibModules = {}

  // 先加载 base 包（标准库）
  for (const [path, content] of Object.entries(baseModules)) {
    const name = path.split('/').pop()?.toLowerCase() ?? ''
    if (name) {
      modules[name] = content as string
    }
  }

  // 再加载 ooc-mve-bridge 包（视图桥接）
  for (const [path, content] of Object.entries(oocMveBridgeModules)) {
    const name = path.split('/').pop()?.toLowerCase() ?? ''
    if (name) {
      modules[name] = content as string
    }
  }

  return modules
}
