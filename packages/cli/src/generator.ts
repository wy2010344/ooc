// OOC → TS 编译器：把 .ooc 源码编译成语义保真的 TypeScript 模块。
// 产物自包含（内联运行时辅助），宿主 globals 经 run(globals) 注入，可被 tsc 检查、进 vite/npm。
import type { Model } from 'object-oriented-c-language'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { extractDestinationAndName } from './util.js'
import { modelToTs } from './tsgen/model.js'

export type CompileOptions = {
  destination?: string
  /** 产物扩展名：默认 .ts。传 .js 可跳过 TS 类型（但会破坏类型透传） */
  extension?: string
}

export function compileToTs(
  model: Model,
  filePath: string,
  options: CompileOptions = {},
): string {
  const data = extractDestinationAndName(filePath, options.destination)
  const ext = options.extension ?? '.ts'
  const outPath = path.join(data.destination, `${data.name}${ext}`)
  const source = `// Generated from ${path.basename(filePath)} (ooc → ts)\n${modelToTs(model)}`
  if (!fs.existsSync(data.destination)) {
    fs.mkdirSync(data.destination, { recursive: true })
  }
  fs.writeFileSync(outPath, source)
  return outPath
}