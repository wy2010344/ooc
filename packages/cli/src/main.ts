import type { Model } from 'object-oriented-c-language'
type OOCModel = Model
import {
  createInterpretAction,
  createObjectOrientedCServices,
  createTypeCheckAction,
  ObjectOrientedCLanguageMetaData,
} from 'object-oriented-c-language'
import chalk from 'chalk'
import { Command } from 'commander'
import { extractAstNode } from './util.js'
import { generateJavaScript } from './generator.js'
import { NodeFileSystem } from 'langium/node'
import * as url from 'node:url'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const packagePath = path.resolve(__dirname, '..', 'package.json')
const packageContent = await fs.readFile(packagePath, 'utf-8')

const DEFAULT_CONFIG = `// config.ooc — OOC 项目配置文件
// 这是一个真正的 OOC 文件，由解释器执行，最后一条表达式返回配置对象。
// 诊断级别：off（隐藏）、warning（警告）、error（错误）
// 所有规则都列在下方，按需取消注释即可。未列出的规则使用默认行为。

{ diagnostics = {
    // --- 类型检查 ---
    // typeMismatch = 'warning',           // 类型不匹配
    // unknownType = 'warning',             // 未知类型名
    // typeNotFound = 'error',              // 类型未找到
    // noImplicitAny = 'off',               // 隐式 any（默认关闭）
    // notGeneric = 'warning',              // 非泛型类型上使用了类型参数
    // typeArgCount = 'warning',            // 类型参数数量不匹配
    // missingTypeArg = 'warning',          // 缺少类型参数

    // --- 调用与重载 ---
    // callArgsMismatch = 'warning',        // 调用参数数量不匹配
    // overloadReturnMismatch = 'warning',  // 重载方法返回类型不匹配
    // guardNotBoolean = 'warning',         // #guard 条件不是布尔
    // partialUnionMessage = 'warning',     // 联合类型成员专属方法未判别

    // --- 重复定义 ---
    // duplicateType = 'error',             // 重复的 typedef
    // duplicateMethod = 'error',          // 重复的方法
    // duplicateParam = 'error',           // 重复的参数

    // --- 变量与赋值 ---
    // reassignmentMismatch = 'warning',    // 重新赋值类型不匹配
} }
`

export const generateAction = async (
  fileName: string,
  opts: GenerateOptions,
): Promise<void> => {
  const services = createObjectOrientedCServices(NodeFileSystem).ObjectOrientedC
  const model = await extractAstNode<OOCModel>(fileName, services)
  const generatedFilePath = generateJavaScript(
    model,
    fileName,
    opts.destination,
  )
  console.log(
    chalk.green(`JavaScript code generated successfully: ${generatedFilePath}`),
  )
}

export type GenerateOptions = {
  destination?: string
}

export const interpretAction =
  createInterpretAction(NodeFileSystem).interpretPath

export const typeCheckAction = async (fileName: string): Promise<void> => {
  const diagnostics = await createTypeCheckAction(NodeFileSystem).checkPath(
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

export default function (): void {
  const program = new Command()

  program.version(JSON.parse(packageContent).version)

  const fileExtensions =
    ObjectOrientedCLanguageMetaData.fileExtensions.join(', ')
  program
    .command('generate')
    .argument(
      '<file>',
      `source file (possible file extensions: ${fileExtensions})`,
    )
    .option('-d, --destination <dir>', 'destination directory of generating')
    .description(
      'generates JavaScript code that prints "Hello, {name}!" for each greeting in a source file',
    )
    .action(generateAction)

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

  program.parse(process.argv)
}
