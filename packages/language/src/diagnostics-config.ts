import type { DiagnosticSeverity } from 'vscode-languageserver-types'
import type { ValidationSeverity } from 'langium'
import { URI, UriUtils } from 'langium'
import {
  DefaultDocumentValidator,
  type ValidationOptions,
} from 'langium'
import type { Diagnostic } from 'vscode-languageserver-types'
import type { LangiumCoreServices } from 'langium'
import type { LangiumDocument } from 'langium'

/** * OOC 项目配置（类似 tsconfig.json），控制类型检查诊断的显示级别。
 *
 * 支持两种格式：
 * 1. ooc.json（向后兼容，JSON 格式，静态解析）
 * 2. config.ooc（真正的 OOC 文件，解释器执行，最后一条表达式返回配置对象）
 *
 * config.ooc 示例（与普通 .ooc 文件完全一致）：
 * // 这是注释
 * diagnostics = {
 *     typeMismatch: 'warning',
 *     noImplicitAny: 'off',
 * }
 *
 * // 最后一条表达式是配置对象（推荐直接写对象）
 * { diagnostics: { typeMismatch: 'error' } }
 *
 * ooc.json 示例：
 * {
 *   "diagnostics": {
 *     "unknownType": "off",
 *     "typeMismatch": "warning"
 *   }
 * }
 */

export type DiagLevel = 'off' | 'warning' | 'error'

export interface OocConfig {
  diagnostics?: Record<string, DiagLevel>
}

/** 类型检查的规则 code（与 type-checker.ts 中 accept 的 data.code 对应） */
export const DIAGNOSTIC_CODES = {
  duplicateType: 'duplicateType',
  reassignmentMismatch: 'reassignmentMismatch',
  typeMismatch: 'typeMismatch',
  overloadReturnMismatch: 'overloadReturnMismatch',
  guardNotBoolean: 'guardNotBoolean',
  notGeneric: 'notGeneric',
  typeArgCount: 'typeArgCount',
  missingTypeArg: 'missingTypeArg',
  unknownType: 'unknownType',
  partialUnionMessage: 'partialUnionMessage',
  callArgsMismatch: 'callArgsMismatch',
  duplicateMethod: 'duplicateMethod',
  duplicateParam: 'duplicateParam',
  noImplicitAny: 'noImplicitAny',
  typeNotFound: 'typeNotFound',
} as const

/**
 * 未在配置里显式设置时的默认级别（类 TS 的 noImplicitAny：
 * 默认关闭，只有显式配置为 warning/error 才报告隐式 any）。
 */
const DEFAULT_DIAGNOSTIC_LEVELS: Partial<Record<DiagnosticCode, DiagLevel>> = {
  noImplicitAny: 'off',
}

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES]

/**
 * 将任意值转换为 OocConfig（从解释器返回值或正则解析结果中提取）。
 * 支持两种格式：
 *   1. { diagnostics: { code: level, ... } }  — 完整配置对象
 *   2. { code: level, ... }                  — 省略 diagnostics 包装
 */
export function toOocConfig(value: unknown): OocConfig {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const obj = value as Record<string, unknown>
  const diags = obj.diagnostics
  if (diags && typeof diags === 'object') {
    return normalizeDiags(diags as Record<string, unknown>)
  }
  // 检查是否是扁平的 { code: level } 格式
  const result: Record<string, DiagLevel> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (isValidCode(k) && (v === 'off' || v === 'warning' || v === 'error')) {
      result[k] = v as DiagLevel
    }
  }
  return Object.keys(result).length > 0 ? { diagnostics: result } : {}
}

function normalizeDiags(diags: Record<string, unknown>): OocConfig {
  const normalized: Record<string, DiagLevel> = {}
  for (const [code, level] of Object.entries(diags)) {
    if (level === 'off' || level === 'warning' || level === 'error') {
      normalized[code] = level
    }
  }
  return { diagnostics: normalized }
}

function isValidCode(code: string): boolean {
  return code in DIAGNOSTIC_CODES
}

/** 解析 ooc.json（JSON 格式，向后兼容） */
export function parseOocJson(text: string): OocConfig {
  try {
    const json = JSON.parse(text.replace(/^\uFEFF/, ''))
    return toOocConfig(json)
  } catch {
    return {}
  }
}

/**
 * ConfigExecutor 类型：用解释器执行配置文件，返回最后一条表达式的值。
 * 由 host.ts 中的 createInterpretAction 提供实现。
 */
export type ConfigExecutor = (
  text: string,
  fileName: string,
) => Promise<unknown>

/** 传入的原始严重级别：数字（DiagnosticSeverity）或字符串（ValidationSeverity） */
export type SeverityLike = DiagnosticSeverity | ValidationSeverity

/**
 * 按配置过滤/转换诊断。
 * @returns 新 severity，类型与入参一致（数字或字符串）；
 *          undefined 表示该条被配置为 off 而隐藏。
 */
export function filterDiagnostic(
  config: OocConfig | undefined,
  severity: SeverityLike | undefined,
  code: string | undefined,
): SeverityLike | undefined {
  if (!code || severity === undefined) {
    return severity
  }
  const level = config?.diagnostics?.[code]
  if (level === undefined) {
    // 未显式配置时：有项目配置对象才套用 code 默认级别（如 noImplicitAny
    // 默认 off）；config 为 undefined 表示尚未读取项目配置，原样放行，
    // 交给上层按最近 ooc.json 决定。
    if (config !== undefined) {
      const def = DEFAULT_DIAGNOSTIC_LEVELS[code as DiagnosticCode]
      if (def === 'off') {
        return undefined
      }
    }
    return severity
  }
  if (level === 'off') {
    return undefined
  }
  if (level === 'error') {
    return typeof severity === 'string' ? 'error' : 1 // DiagnosticSeverity.Error
  }
  if (level === 'warning') {
    return typeof severity === 'string' ? 'warning' : 2 // DiagnosticSeverity.Warning
  }
  return severity
}

/** 从诊断对象里取规则 code（Langium 将 accept 的 data 放入诊断的 data） */
export function codeOfDiagnostic(diagnostic: { data?: unknown }): string | undefined {
  const data = diagnostic.data
  if (data && typeof data === 'object' && 'code' in data) {
    const code = (data as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/** 解析挂在节点上的诊断 code（用于 accept 的 data.code） */
export function diagnosticData(code: DiagnosticCode): { code: DiagnosticCode } {
  return { code }
}

/**
 * 从项目根读取配置文件（优先 config.ooc，其次 ooc.json），不存在则返回空配置。
 * @param fs 语言服务的 FileSystemProvider
 * @param rootPath 项目根目录
 * @param executor 可选的配置文件执行器（用解释器执行 config.ooc）
 */
export async function loadOocConfig(
  fs: {
    exists: (uri: URI) => Promise<boolean> | boolean
    readFile: (uri: URI) => Promise<string> | string
  },
  rootPath: string,
  executor?: ConfigExecutor,
): Promise<OocConfig> {
  try {
    // 优先查找 config.ooc（真正的 OOC 文件，用解释器执行）
    const configUri = UriUtils.joinPath(URI.file(rootPath), 'config.ooc')
    if (await fs.exists(configUri)) {
      const text = await fs.readFile(configUri)
      if (executor) {
        try {
          const result = await executor(text, configUri.path)
          return toOocConfig(result)
        } catch {
          return {}
        }
      }
      // 无解释器时回退到静态解析（LSP 环境）
      return parseOocJson(text)
    }
    // 回退到 ooc.json（向后兼容，JSON 格式）
    const jsonUri = UriUtils.joinPath(URI.file(rootPath), 'ooc.json')
    if (await fs.exists(jsonUri)) {
      const text = await fs.readFile(jsonUri)
      return parseOocJson(text)
    }
    return {}
  } catch {
    return {}
  }
}

/** 从文件所在目录逐级向上找最近的一个 config.ooc / ooc.json（类 tsconfig 查找语义） */
export async function findNearestOocConfig(
  fs: {
    exists: (uri: URI) => Promise<boolean> | boolean
    readFile: (uri: URI) => Promise<string> | string
  },
  startDir: string,
  executor?: ConfigExecutor,
): Promise<OocConfig> {
  let dir = startDir
  for (;;) {
    const cfg = await loadOocConfig(fs, dir, executor)
    const keys = Object.keys(cfg.diagnostics ?? {})
    if (keys.length > 0) {
      return cfg
    }
    const parent = dirnameForConfig(dir)
    if (parent === dir) {
      return {}
    }
    dir = parent
  }
}

/**
 * 在 Langium 文档校验后按最近 config.ooc / ooc.json 过滤诊断。
 * 校验逻辑完全复用默认实现，只对产出的诊断做配置过滤/升降级。
 */
export class ConfigAwareDocumentValidator extends DefaultDocumentValidator {
  private readonly fs: {
    exists: (uri: URI) => Promise<boolean> | boolean
    readFile: (uri: URI) => Promise<string> | string
  }

  private readonly executor?: ConfigExecutor

  constructor(services: LangiumCoreServices, executor?: ConfigExecutor) {
    super(services)
    this.fs = services.shared.workspace.FileSystemProvider
    this.executor = executor
  }

  override async validateDocument(
    document: LangiumDocument,
    options?: ValidationOptions,
    cancelToken?: unknown,
  ): Promise<Diagnostic[]> {
    const diagnostics = await super.validateDocument(
      document,
      options,
      // 结构类型：CancellationToken 只是接口，透传无妨
      cancelToken as never,
    )
    const config = await findNearestOocConfig(
      this.fs,
      dirnameForConfig(uriToPath(document.uri)),
      this.executor,
    )
    return diagnostics.flatMap((d) => {
      const next = filterDiagnostic(config, d.severity, codeOfDiagnostic(d))
      if (next === undefined) {
        return []
      }
      // 应用配置后的严重级别（warning -> error / 保持原级）
      return [{ ...d, severity: next as DiagnosticSeverity }]
    })
  }
}

export function uriToPath(uri: URI): string {
  return decodeURIComponent(uri.path)
}

/** 取目录部分（兼容 Windows 反斜杠） */
export function dirnameForConfig(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const idx = norm.lastIndexOf('/')
  return idx <= 0 ? '/' : norm.slice(0, idx)
}
