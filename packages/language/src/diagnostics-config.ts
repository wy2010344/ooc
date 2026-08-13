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
import { isModel } from './generated/ast.js'
import { interpret } from './interpreter/evaluate.js'
import { withGlobals } from './interpreter/scope.js'

/** * OOC 项目配置（类似 tsconfig.json），控制类型检查诊断的显示级别。
 *
 * 支持两种格式：
 * 1. ooc.json（向后兼容，JSON 格式，静态解析）
 * 2. config.ooc（真正的 OOC 文件，解释器执行，最后一条表达式返回配置对象）
 *
 * config.ooc 示例（与普通 .ooc 文件完全一致，OOC 对象用 = 绑定）：
 * // 这是注释
 * { diagnostics = {
 *     typeMismatch = 'warning',
 *     noImplicitAny = 'off',
 * } }
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

/** 空配置单例（无任何诊断规则） */
const EMPTY_OOC_CONFIG: OocConfig = Object.freeze({})

/** 简单字符串 hash（FNV-1a 32位），用于缓存键生成 */
function hashStr(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
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
 * 从 OOC 解释器返回值中提取 OocConfig。
 * OOC 对象的属性都是方法函数（如 obj.diagnostics() 返回内层对象），
 * 需要调用这些方法才能取到实际值。
 */
export function toOocConfig(value: unknown): OocConfig {
  if (!value || typeof value !== 'object') {
    return EMPTY_OOC_CONFIG
  }
  const obj = value as Record<string, unknown>
  // OOC 对象属性是方法函数，需要调用才能取值
  const rawDiags = extractOocValue(obj, 'diagnostics')
  if (rawDiags && typeof rawDiags === 'object') {
    const normalized = extractDiagLevels(rawDiags as Record<string, unknown>)
    return { diagnostics: normalized }
  }
  // 检查是否是扁平的 { code: level } 格式
  const flatResult = extractDiagLevels(obj)
  return Object.keys(flatResult).length > 0
    ? { diagnostics: flatResult }
    : EMPTY_OOC_CONFIG
}

/**
 * 从 OOC 对象中提取命名属性值：OOC 对象属性是方法，
 * 调用后返回实际值；如果不是函数则直接返回。
 */
function extractOocValue(obj: Record<string, unknown>, key: string): unknown {
  const v = obj[key]
  if (typeof v === 'function') {
    try {
      return (v as () => unknown).call(obj)
    } catch {
      return v
    }
  }
  return v
}

/**
 * 从 OOC 对象或普通对象中提取诊断级别键值对。
 * OOC 对象的属性是方法函数，需要调用求值。
 */
function extractDiagLevels(
  obj: Record<string, unknown>,
): Record<string, DiagLevel> {
  const result: Record<string, DiagLevel> = {}
  for (const [code, raw] of Object.entries(obj)) {
    if (!isValidCode(code)) continue
    const level = typeof raw === 'function' ? raw.call(obj) : raw
    if (level === 'off' || level === 'warning' || level === 'error') {
      result[code] = level as DiagLevel
    }
  }
  return result
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
    return EMPTY_OOC_CONFIG
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
 * 从单目录加载配置：优先 config.ooc（解释器执行），回退 ooc.json（静态解析）。
 * 这是所有配置读取的核心实现，CLI 和 LSP 共用。
 */
async function loadConfigForDir(
  fs: {
    exists: (uri: URI) => Promise<boolean> | boolean
    readFile: (uri: URI) => Promise<string> | string
  },
  dirPath: string,
  executor?: ConfigExecutor,
): Promise<OocConfig> {
  try {
    // 优先查找 config.ooc（真正的 OOC 文件，用解释器执行）
    const configUri = UriUtils.joinPath(URI.file(dirPath), 'config.ooc')
    if (await fs.exists(configUri)) {
      const text = await fs.readFile(configUri)
      if (executor) {
        try {
          const result = await executor(text, configUri.path)
          return toOocConfig(result)
        } catch {
          return EMPTY_OOC_CONFIG
        }
      }
      // 无解释器时回退到静态解析
      return parseOocJson(text)
    }
    // 回退到 ooc.json（向后兼容，JSON 格式）
    const jsonUri = UriUtils.joinPath(URI.file(dirPath), 'ooc.json')
    if (await fs.exists(jsonUri)) {
      const text = await fs.readFile(jsonUri)
      return parseOocJson(text)
    }
    return EMPTY_OOC_CONFIG
  } catch {
    return EMPTY_OOC_CONFIG
  }
}

/** 从项目根读取配置文件（公开 API，CLI 使用） */
export async function loadOocConfig(
  fs: {
    exists: (uri: URI) => Promise<boolean> | boolean
    readFile: (uri: URI) => Promise<string> | string
  },
  rootPath: string,
  executor?: ConfigExecutor,
): Promise<OocConfig> {
  return loadConfigForDir(fs, rootPath, executor)
}

/** 从文件所在目录逐级向上找最近的一个 config.ooc / ooc.json（CLI 使用） */
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
    const cfg = await loadConfigForDir(fs, dir, executor)
    const keys = Object.keys(cfg.diagnostics ?? {})
    if (keys.length > 0) {
      return cfg
    }
    const parent = dirnameForConfig(dir)
    if (parent === dir) {
      return EMPTY_OOC_CONFIG
    }
    dir = parent
  }
}

/**
 * 用解释器执行 config.ooc：用 LangiumParser 解析后直接 interpret。
 * 可在 LSP / CLI 任意环境下使用，只要有 LangiumCoreServices。
 * config.ooc 通常无 #import；若有，传入 interpretAction 处理。
 */
export async function executeConfigOoc(
  text: string,
  filePath: string,
  services: LangiumCoreServices,
  interpretAction?: (name: string, basePath?: string) => Promise<any>,
): Promise<unknown> {
  const parseResult = services.parser.LangiumParser.parse(text)
  if (parseResult.lexerErrors.length > 0 || parseResult.parserErrors.length > 0) {
    return {}
  }
  const model = parseResult.value
  if (!isModel(model)) {
    return {}
  }
  const noop: (name: string, basePath?: string) => Promise<any> =
    async () => undefined
  return interpret(
    model,
    withGlobals(undefined, {}),
    filePath,
    interpretAction ?? noop,
  )
}

/**
 * 在 Langium 文档校验后按最近 config.ooc / ooc.json 过滤诊断。
 * 配置文件通过解释器执行（config.ooc）或静态解析（ooc.json），
 * 缓存键为「路径 + 内容 hash」，文件变更时自动失效。
 */
export class ConfigAwareDocumentValidator extends DefaultDocumentValidator {
  private readonly fs: {
    exists: (uri: URI) => Promise<boolean> | boolean
    readFile: (uri: URI) => Promise<string> | string
  }

  private readonly services: LangiumCoreServices

  /** 配置缓存：缓存键 = 路径 + ':' + 内容 hash，文件变更自动失效 */
  private readonly configCache = new Map<string, OocConfig>()

  constructor(services: LangiumCoreServices) {
    super(services)
    this.fs = services.shared.workspace.FileSystemProvider
    this.services = services
  }

  override async validateDocument(
    document: LangiumDocument,
    options?: ValidationOptions,
    cancelToken?: unknown,
  ): Promise<Diagnostic[]> {
    const diagnostics = await super.validateDocument(
      document,
      options,
      cancelToken as never,
    )
    const docDir = dirnameForConfig(uriToPath(document.uri))
    const config = await this.findConfigCached(docDir)
    // 无论是否有配置都走 filterDiagnostic：
    // - EMPTY_OOC_CONFIG 时仍需应用默认级别（如 noImplicitAny 默认 off）
    // - 有配置时按配置调整
    return diagnostics.flatMap((d) => {
      const next = filterDiagnostic(config, d.severity, codeOfDiagnostic(d))
      if (next === undefined) {
        return []
      }
      return [{ ...d, severity: next as DiagnosticSeverity }]
    })
  }

  /** 带缓存的配置查找：内容 hash 作为缓存键，文件变更自动失效 */
  private async findConfigCached(startDir: string): Promise<OocConfig> {
    let dir = startDir
    for (;;) {
      const cfg = await this.loadConfigForDirCached(dir)
      if (cfg !== EMPTY_OOC_CONFIG) {
        const keys = Object.keys(cfg.diagnostics ?? {})
        if (keys.length > 0) {
          return cfg
        }
      }
      const parent = dirnameForConfig(dir)
      if (parent === dir) {
        return EMPTY_OOC_CONFIG
      }
      dir = parent
    }
  }

  /** 单目录缓存加载：读取内容 → 计算 hash → 命中则复用，未命中则执行/解析 */
  private async loadConfigForDirCached(dir: string): Promise<OocConfig> {
    const configUri = UriUtils.joinPath(URI.file(dir), 'config.ooc')
    const jsonUri = UriUtils.joinPath(URI.file(dir), 'ooc.json')

    // 优先 config.ooc
    if (await this.fs.exists(configUri)) {
      const text = await this.fs.readFile(configUri)
      const cacheKey = configUri.path + ':' + hashStr(text)
      const cached = this.configCache.get(cacheKey)
      if (cached) {
        return cached
      }
      try {
        const result = await executeConfigOoc(text, configUri.path, this.services)
        const config = toOocConfig(result)
        this.configCache.set(cacheKey, config)
        return config
      } catch {
        // 执行失败，回退到 ooc.json
      }
    }
    // 回退 ooc.json
    if (await this.fs.exists(jsonUri)) {
      const text = await this.fs.readFile(jsonUri)
      const cacheKey = jsonUri.path + ':' + hashStr(text)
      const cached = this.configCache.get(cacheKey)
      if (cached) {
        return cached
      }
      const config = parseOocJson(text)
      this.configCache.set(cacheKey, config)
      return config
    }
    return EMPTY_OOC_CONFIG
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
