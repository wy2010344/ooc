// 项目级编译器：ooc build <entry> —— 遍历依赖图把整棵 .ooc 模块树编译成 .ts。
// 产物形态：共享 _ooc_runtime.ts + 每个模块的 run(globals)；模块间 #import 编译为 ES import
// （被依赖模块默认导出 run），模块图交付 vite/tsc 处理——不再需要浏览器解释器/虚拟文件系统/loader。
import type { Model } from 'object-oriented-c-language'
import {
  createObjectOrientedCServices,
  createPackageAwareFileSystem,
  createDirPackageResolver,
  resolvePackageModule,
  isPackageRef,
} from 'object-oriented-c-language'
import type { LangiumCoreServices } from 'langium'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { NodeFileSystem } from 'langium/node'
import { extractAstNode } from './util.js'
import { modelToTs } from './tsgen/model.js'
import { OOC_RUNTIME_MODULE } from './tsgen/runtime-template.js'
import { MODULES_DIR_NAME } from './install.js'

/** 共享运行时产物文件名：各模块以相对 import 引用它。 */
export const RUNTIME_FILE = '_ooc_runtime.ts'

export type BuildResult = {
  /** 已编译模块：source 为源码绝对路径，out 为产物绝对路径 */
  files: Array<{ source: string; out: string }>
  /** 入口产物绝对路径 */
  entryOut: string
  /** 共享运行时产物绝对路径 */
  runtimeOut: string
}

export type BuildOptions = {
  /** 入口 .ooc（相对 rootDir 或绝对） */
  entry: string
  /** 项目根目录（默认 process.cwd()）：项目源码按相对该目录的路径输出 */
  rootDir?: string
  /** 输出目录（默认 <rootDir>/generated） */
  outDir?: string
  /** 包安装目录（默认 <rootDir>/.ooc_modules） */
  modulesDir?: string
}

/**
 * 解析一个 #import 原值到真实源码文件。
 * - '@pkg'/sub：经 module-path 虚拟路径 /ooc-pkg/<pkg>/<file> → modulesDir/<pkg>/<file>
 * - 相对路径：相对 fromFile 目录；无扩展名补 .ooc
 */
export function resolveImportSource(
  raw: string,
  fromFile: string,
  modulesDir: string,
): string {
  if (isPackageRef(raw)) {
    const vp = resolvePackageModule(raw, ['.ooc'])
    const rest = vp.slice('/ooc-pkg/'.length)
    const slash = rest.indexOf('/')
    const pkg = slash === -1 ? rest : rest.slice(0, slash)
    const sub = slash === -1 ? 'index.ooc' : rest.slice(slash + 1)
    return path.resolve(modulesDir, pkg, sub)
  }
  let target = path.resolve(path.dirname(fromFile), raw)
  if (path.extname(target) === '') {
    target += '.ooc'
  }
  return target
}

/**
 * 源码文件 → 产物文件（绝对路径）。
 * 包文件（modulesDir 下）映射到 <outDir>/ooc-pkg/<pkg>/<file>.ts；
 * 项目文件映射到 <outDir>/<相对工作目录的路径>.ts。
 */
function outPathFor(
  source: string,
  rootDir: string,
  modulesDir: string,
  outDir: string,
): string {
  const relModules = path.relative(modulesDir, source)
  if (relModules && !relModules.startsWith('..') && !path.isAbsolute(relModules)) {
    const tsPath = relModules.replace(/\.ooc$/, '.ts')
    return path.join(outDir, 'ooc-pkg', tsPath)
  }
  const relRoot = path.relative(rootDir, source).replace(/\.ooc$/, '.ts')
  return path.join(outDir, relRoot)
}

/** 从 srcOut（未写完但已知绝对路径）指向 dstOut 的相对 import 说明符（posix、带 .ts 后缀）。 */
function importSpecifier(srcOut: string, dstOut: string): string {
  const rel = path.relative(path.dirname(srcOut), dstOut).replace(/\\/g, '/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** 收集模型里的 #import 原值（ImportStatement 的两种形态：默认导入与命名导入）。 */
export function collectImports(model: Model): string[] {
  const out: string[] = []
  for (const st of model.expressions) {
    const maybeImport = st as any
    if (maybeImport.$type === 'ImportStatement') {
      out.push(maybeImport.path)
    }
  }
  return out
}

/**
 * 提取模型里全部顶层 typedef（#type）名：命名导入用它区分「类型」与「值」导出。
 * 文档不可见（undefined）时返回空数组（按值处理）。
 */
export function typeExportNames(model?: Model): string[] {
  if (!model) {
    return []
  }
  const out: string[] = []
  for (const st of model.expressions) {
    if (st.$type === 'TypeDef') {
      out.push((st as any).name)
    }
  }
  return out
}

/**
 * 编译项目：从 entry 出发 BFS 解析依赖图，每个模块产出一个 .ts，并写出共享 `_ooc_runtime.ts`。
 * 典型脚本：`ooc install <包源>` → `ooc build src/main.ooc -o <outDir>`。
 */
export async function buildProject(options: BuildOptions): Promise<BuildResult> {
  const rootDir = options.rootDir ?? process.cwd()
  const modulesDir = options.modulesDir ?? path.resolve(rootDir, MODULES_DIR_NAME)
  const outDir = options.outDir ?? path.resolve(rootDir, 'generated')

  // 包感知的解析服务：#import '@pkg' 经 pkg 解析器重定向到 modulesDir
  const services: LangiumCoreServices = createObjectOrientedCServices({
    fileSystemProvider: () =>
      createPackageAwareFileSystem(
        NodeFileSystem.fileSystemProvider(),
        createDirPackageResolver(modulesDir),
      ),
  }).ObjectOrientedC

  // BFS 依赖图：source → Model
  const models = new Map<string, Model>()
  const queue: string[] = [path.resolve(rootDir, options.entry)]
  while (queue.length > 0) {
    const source = queue.shift()!
    if (models.has(source)) continue
    const model = await extractAstNode<Model>(source, services)
    models.set(source, model)
    for (const raw of collectImports(model)) {
      const dep = resolveImportSource(raw, source, modulesDir)
      if (!models.has(dep)) {
        queue.push(dep)
      }
    }
  }

  // 生成产物：共享运行时 + 各模块 .ts
  fs.mkdirSync(outDir, { recursive: true })
  const runtimeOut = path.join(outDir, RUNTIME_FILE)
  fs.writeFileSync(runtimeOut, OOC_RUNTIME_MODULE + '\n')

  const files: BuildResult['files'] = []
  for (const source of models.keys()) {
    const out = outPathFor(source, rootDir, modulesDir, outDir)
    // 该模块的依赖（按 AST 里 #import 出现顺序）：<原值, 目标产物说明符, 类型导出名>
    const deps = collectImports(models.get(source)!).map((raw) => ({
      path: raw,
      specifier: importSpecifier(
        out,
        outPathFor(resolveImportSource(raw, source, modulesDir), rootDir, modulesDir, outDir),
      ),
      typeNames: typeExportNames(
        models.get(resolveImportSource(raw, source, modulesDir)),
      ),
      // CLI build 的依赖全部是 .ooc 模块（顶层声明经 __oocNamed 包导出）
      ooc: true,
    }))
    const runtimeImport = importSpecifier(out, runtimeOut)
    const sourceText =
      `// Generated from ${path.relative(rootDir, source).replace(/\\/g, '/')} (ooc → ts)\n` +
      modelToTs(models.get(source)!, { runtimeImport, deps })
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, sourceText)
    files.push({ source, out })
  }

  return {
    files,
    entryOut: outPathFor(path.resolve(rootDir, options.entry), rootDir, modulesDir, outDir),
    runtimeOut,
  }
}