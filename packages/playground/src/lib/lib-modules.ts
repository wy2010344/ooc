/**
 * 外部库模块预加载：
 * 使用 vite 的 import.meta.glob 预加载 ooc-mve-bridge 包的 .ooc 文件，
 * 供虚拟文件系统使用，让 OOC 代码可以通过 #import 引用这些模块。
 */

// 预加载 ooc-mve-bridge 包的 .ooc 文件
const oocMveBridgeModules = import.meta.glob(
  '../../../../ooc-mve-bridge/src/*.ooc',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
)

// 预加载 base 包的 .ooc 文件（标准库）
const baseModules = import.meta.glob(
  '../../../../base/src/*.ooc',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
)

/** 外部库模块：name → source */
export interface LibModules {
  [name: string]: string
}

/** 获取所有外部库模块 */
export function getLibModules(): LibModules {
  const modules: LibModules = {}

  // 先加载 base 包（标准库）
  for (const [path, content] of Object.entries(baseModules)) {
    const name = path.split('/').pop()?.replace('.ooc', '') ?? ''
    if (name) {
      modules[name.toLowerCase()] = content as string
    }
  }

  // 再加载 ooc-mve-bridge 包（视图桥接）
  for (const [path, content] of Object.entries(oocMveBridgeModules)) {
    const name = path.split('/').pop()?.replace('.ooc', '') ?? ''
    if (name) {
      modules[name.toLowerCase()] = content as string
    }
  }

  return modules
}
