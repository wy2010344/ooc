import type { Engine } from './engine.js'
import { formatValue } from './engine.js'

export interface RunResult {
  output: string
  error: string | null
  diagnostics: AppDiagnostic[]
  durationMs: number
}

export interface AppDiagnostic {
  severity: string
  message: string
}

/**
 * 每次运行用独立的会话路径执行同一笔记：Langium 文档注册表不允许同一 URI
 * 出现两份文档，重复运行同一条笔记（同名文件）会冲突。
 * 保持 basename=笔记名，让 #import 按名解析虚拟机文件系统；前缀保证唯一。
 */
let runSeq = 0
function runNameFor(name: string): string {
  runSeq++
  const base = name.endsWith('.ooc') ? name : `${name}.ooc`
  return `__ooc-run-${runSeq}/${base}`
}

/** 执行一条笔记并做静态检查（复用 language 的解释器与类型检查器） */
export async function runNote(
  engine: Engine,
  name: string,
  source: string,
): Promise<RunResult> {
  const diagnostics: AppDiagnostic[] = []
  const started = performance.now()
  const runName = runNameFor(name)

  // 语法错误先拦截（与解释器行为一致：只拦语法，不拦类型）
  try {
    const result = await engine.typeCheck.check(source, runName)
    for (const d of result) {
      diagnostics.push({
        severity: d.severity === 2 ? 'warning' : d.severity === 1 ? 'error' : 'info',
        message: d.message,
      })
    }
  } catch (err) {
    diagnostics.push({ severity: 'error', message: String(err) })
  }

  let output = ''
  let error: string | null = null
  try {
    const value = await engine.interpret.interpret(source, runName)
    output = formatValue(value)
  } catch (err) {
    error = String(err)
  }

  return { output, error, diagnostics, durationMs: performance.now() - started }
}