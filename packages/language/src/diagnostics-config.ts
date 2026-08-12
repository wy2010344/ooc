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
 * 约定文件名为项目根的 ooc.json：
 * {
 *   "diagnostics": {
 *     "unknownType": "off",        // 隐藏
 *     "typeMismatch": "warning",   // 默认
 *     "callArgsMismatch": "error"  // 提升为错误
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
 * 未在 ooc.json 里显式配置时的默认级别（类 TS 的 noImplicitAny：
 * 默认关闭，只有显式配置为 warning/error 才报告隐式 any）。
 */
const DEFAULT_DIAGNOSTIC_LEVELS: Partial<Record<DiagnosticCode, DiagLevel>> = {
  noImplicitAny: 'off',
}

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES]

export function parseOocConfig(text: string): OocConfig {
  try {
    // Windows 编辑器保存的 UTF-8 BOM 会让 JSON.parse 直接失败，先剥掉
    const json = JSON.parse(text.replace(/^\uFEFF/, ''))
    const diags = json?.diagnostics
    if (diags && typeof diags === 'object') {
      const normalized: Record<string, DiagLevel> = {}
      for (const [code, level] of Object.entries(diags)) {
        if (level === 'off' || level === 'warning' || level === 'error') {
          normalized[code] = level
        }
      }
      return { diagnostics: normalized }
    }
    return {}
  } catch {
    return {}
  }
}

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
 * 从项目根读取 ooc.json（类似 tsconfig.json），不存在则返回空配置。
 * @param fs 语言服务的 FileSystemProvider（Node 用 NodeFileSystem，浏览器用虚拟 FS）
 * @param rootPath 项目根目录（决定 ooc.json 的查找位置）
 */
export async function loadOocConfig(
  fs: {
    exists: (uri: URI) => Promise<boolean> | boolean
    readFile: (uri: URI) => Promise<string> | string
  },
  rootPath: string,
): Promise<OocConfig> {
  try {
    // 用 joinPath 拼接而不是字符串 `${rootPath}/ooc.json`：rootPath 为 '/' 时
    // 会拼出 '//ooc.json'（URI.file 解析成 file://ooc.json/，fsPath 变成根目录）。
    const uri = UriUtils.joinPath(URI.file(rootPath), 'ooc.json')
    if (!(await fs.exists(uri))) {
      return {}
    }
    const text = await fs.readFile(uri)
    return parseOocConfig(text)
  } catch {
    return {}
  }
}

/** 从文件所在目录逐级向上找最近的一个 ooc.json（类 tsconfig 查找语义） */
export async function findNearestOocConfig(
  fs: {
    exists: (uri: URI) => Promise<boolean> | boolean
    readFile: (uri: URI) => Promise<string> | string
  },
  startDir: string,
): Promise<OocConfig> {
  let dir = startDir
  for (;;) {
    const cfg = await loadOocConfig(fs, dir)
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

function dirnameForConfig(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const idx = norm.lastIndexOf('/')
  return idx <= 0 ? '/' : norm.slice(0, idx)
}

/**
 * 在 Langium 文档校验后按最近 ooc.json 过滤诊断。
 * 校验逻辑完全复用默认实现，只对产出的诊断做配置过滤/升降级。
 */
export class ConfigAwareDocumentValidator extends DefaultDocumentValidator {
  private readonly fs: {
    exists: (uri: URI) => Promise<boolean> | boolean
    readFile: (uri: URI) => Promise<string> | string
  }

  constructor(services: LangiumCoreServices) {
    super(services)
    this.fs = services.shared.workspace.FileSystemProvider
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

function uriToPath(uri: URI): string {
  return decodeURIComponent(uri.path)
}
