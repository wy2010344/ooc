import type { Model } from 'object-oriented-c-language'
type OOCModel = Model
import {
  createInterpretAction,
  createObjectOrientedCServices,
  createPackageAwareFileSystem,
  createTypeCheckAction,
  createDirPackageResolver,
  delegate,
  js,
  storage,
  ObjectOrientedCLanguageMetaData,
} from 'object-oriented-c-language'
import chalk from 'chalk'
import { Command } from 'commander'
import { extractAstNode } from './util.js'
import { compileToTs } from './generator.js'
import type { CompileOptions } from './generator.js'
import { buildProject, RUNTIME_FILE } from './build.js'
import { installPackage, MODULES_DIR_NAME } from './install.js'
import { NodeFileSystem } from 'langium/node'
import * as url from 'node:url'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const packagePath = path.resolve(__dirname, '..', 'package.json')
const packageContent = await fs.readFile(packagePath, 'utf-8')

/**
 * 包感知的 Langium 上下文：把 /ooc-pkg/<name>/<file> 重定向到 <cwd>/.ooc_modules/<name>/<file>，
 * 让 interpret / type-check 能解析 @name 包引用，其余文件仍走 NodeFileSystem。
 */
function pkgContext() {
  const modulesDir = path.resolve(process.cwd(), MODULES_DIR_NAME)
  return {
    fileSystemProvider: () =>
      createPackageAwareFileSystem(
        NodeFileSystem.fileSystemProvider(),
        createDirPackageResolver(modulesDir),
      ),
  }
}

const DEFAULT_CONFIG = `// config.ooc — OOC 项目配置文件
// 这是一个真正的 OOC 文件，由解释器执行，最后一条表达式返回配置对象。
// 未列出的诊断规则使用默认行为；需要时可在这里声明 globals 的类型清单
// （globals 成员只列本项目用到的全局对象名字，类型来自各宿主包类型源）。

config = {
    diagnostics = {
        // typeMismatch = 'warning',
        // unknownType = 'off',
        // noImplicitAny = 'off'
    },
    globals = {
        storage = storage,
        js = js,
        delegate = delegate
    }
};

config
`

export const compileAction = async (
  fileName: string,
  opts: CompileOptions,
): Promise<void> => {
  const services = createObjectOrientedCServices(NodeFileSystem).ObjectOrientedC
  const model = await extractAstNode<OOCModel>(fileName, services)
  const generatedFilePath = compileToTs(model, fileName, opts)
  console.log(chalk.green(`TypeScript code generated successfully: ${generatedFilePath}`))
}

/** 项目级编译：从入口 BFS 依赖图，全部 .ooc → .ts（共享 _ooc_runtime.ts + ES import 模块树）。 */
export const buildAction = async (
  entry: string,
  opts: { out: string | undefined },
): Promise<void> => {
  const result = await buildProject({ entry, outDir: opts.out })
  console.log(
    chalk.green(
      `Built ${result.files.length} module(s) → ${path.relative(process.cwd(), result.entryOut)}`,
    ),
  )
  console.log(chalk.green(`Runtime: ${RUNTIME_FILE} (shared)`))
}

export const interpretAction = (fileName: string) => {
  // 注入语言包自带宿主桥接（storage/js/delegate），与浏览器 demo 一致，
  // 让同一份 OOC 项目源码在 Node（CLI）与浏览器（vite）端行为相同。
  return createInterpretAction(pkgContext(), { storage, js, delegate }).interpretPath(
    fileName,
  )
}

export const typeCheckAction = async (fileName: string): Promise<void> => {
  const diagnostics = await createTypeCheckAction(pkgContext()).checkPath(
    fileName,
  )
  if (diagnostics.length === 0) {
    console.log(chalk.green('No type errors or warnings.'))
    return
  }
  let hasError = false
  for (const diagnostic of diagnostics) {
    const severity = diagnostic.severity
    if (severity === 1) {
      hasError = true
    }
    const line = diagnostic.range.start.line + 1
    const text = diagnostic.message
    const prefix = severity === 1 ? chalk.red('error') : chalk.yellow('warning')
    console.log(`${prefix} line ${line}: ${text}`)
  }
  if (hasError) {
    process.exit(1)
  }
}

export async function initAction(): Promise<void> {
  const target = path.resolve(process.cwd(), 'config.ooc')
  try {
    await fs.access(target)
    console.log(chalk.yellow(`config.ooc already exists at ${target}`))
    console.log('Remove it first to re-initialize.')
    return
  } catch {
    // 文件不存在，继续创建
  }
  await fs.writeFile(target, DEFAULT_CONFIG, 'utf-8')
  console.log(chalk.green(`Created config.ooc at ${target}`))
  console.log('Edit it to configure diagnostic levels for your project.')
}

export async function installAction(source: string): Promise<void> {
  const modulesRoot = path.resolve(process.cwd(), MODULES_DIR_NAME)
  const result = await installPackage(source, modulesRoot)
  console.log(
    chalk.green(
      `Installed package '${result.name}' (${result.fileCount} files) → ${path.relative(process.cwd(), result.destDir)}`,
    ),
  )
}

export { modelToTs } from './tsgen/model.js'
export { OOC_RUNTIME_MODULE } from './tsgen/runtime-template.js'
export { buildProject, resolveImportSource, collectImports, typeExportNames } from './build.js'
export { installPackage, readPackageManifest } from './install.js'

export default function (): void {
  const program = new Command()

  program.version(JSON.parse(packageContent).version)

  const fileExtensions =
    ObjectOrientedCLanguageMetaData.fileExtensions.join(', ')
  program
    .command('compile')
    .argument(
      '<file>',
      `source file (possible file extensions: ${fileExtensions})`,
    )
    .option('-d, --destination <dir>', 'destination directory of compiling')
    .description(
      'compiles the source file to a self-contained TypeScript module (semantic-faithful dispatch, keeps type annotations)',
    )
    .action(compileAction)

  program
    .command('build')
    .argument(
      '<entry>',
      `entry source file (possible file extensions: ${fileExtensions})`,
    )
    .option('-o, --out <dir>', 'output directory (default: ./generated)')
    .description(
      `compiles the whole dependency tree from an entry to TypeScript modules sharing ${RUNTIME_FILE} — the browser/runtime loads ordinary ES imports, no interpreter needed`,
    )
    .action(buildAction)

  program
    .command('interpret')
    .argument(
      '<file>',
      `source file (possible file extensions: ${fileExtensions})`,
    )
    .description('interprets the source file')
    .action(interpretAction)

  program
    .command('type-check')
    .argument(
      '<file>',
      `source file (possible file extensions: ${fileExtensions})`,
    )
    .description('static type checking, reports diagnostics without running')
    .action(typeCheckAction)

  program
    .command('init')
    .description('create a config.ooc file in the current directory')
    .action(initAction)

  program
    .command('install')
    .argument('<source>', 'local package root directory or git repository URL')
    .description(
      `install an OOC package into ${MODULES_DIR_NAME}/<name>/ (resolvable via #import '@name')`,
    )
    .action(installAction)

  program.parse(process.argv)
}
