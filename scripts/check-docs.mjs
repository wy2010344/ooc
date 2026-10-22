#!/usr/bin/env node
// 文档代码块校验：把 README 与 docs/guide 里的 ```ooc 块抽出来，逐个跑
// `ooc type-check` 的同一套校验器（语言包 createTypeCheckAction）。
//
// 为什么需要它：`.ooc` 的换行不是语句分隔符，少了 `;` 时两条语句会被**合并成一条消息链**
// ——有时直接 parse error，有时只出一条「调用参数不匹配」的 warning，示例注释里写的值
// 与实际语义对不上。文档示例一旦腐化，读者复制进 playground 就是错误。
//
// 约定（写在代码块上一行的 HTML 注释里，渲染时不可见）：
//   <!-- ooc-check: skip — 原因 -->     整块不检查（片段、跨包路径、故意的报错演示）
//   <!-- ooc-check: warning — 原因 -->  允许 warning，不允许 error（故意演示诊断的块）
// 默认：必须零诊断。
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeFileSystem } from 'langium/node'
import { createTypeCheckAction } from 'object-oriented-c-language'
import { createBridgeGlobalsTypes } from 'ooc-mve-bridge/types'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 校验范围：README + 指南每一章。 */
async function collectFiles() {
  const guideDir = path.join(ROOT, 'docs', 'guide')
  const names = (await fs.readdir(guideDir))
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => path.join('docs', 'guide', n))
  return ['README.md', ...names]
}

const DIRECTIVE = /^<!--\s*ooc-check:\s*(skip|warning)\b[\s—:-]*(.*?)-->\s*$/

/** 从 Markdown 文本里切出所有 ```ooc 块及紧邻其上的指令。 */
function extractBlocks(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^```ooc\s*$/.test(lines[i])) {
      continue
    }
    // 向上找最近一行非空：是指令就用它，否则视为默认严格模式
    let mode = 'strict'
    let reason = ''
    for (let k = i - 1; k >= 0; k--) {
      if (lines[k].trim() === '') {
        continue
      }
      const hit = lines[k].trim().match(DIRECTIVE)
      if (hit) {
        mode = hit[1]
        reason = hit[2].trim()
      }
      break
    }
    const body = []
    let j = i + 1
    while (j < lines.length && !/^```\s*$/.test(lines[j])) {
      body.push(lines[j])
      j++
    }
    blocks.push({
      // 代码块首行的文档行号（1 基），用于把诊断行映射回文档
      startLine: i + 2,
      code: body.join('\n'),
      mode,
      reason,
    })
    i = j
  }
  return blocks
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-doc-check-'))
  // 示例里出现的同目录模块（docs/guide/_fixtures），复制进临时目录供 #import 解析
  const fixtures = path.join(ROOT, 'docs', 'guide', '_fixtures')
  try {
    await fs.cp(fixtures, tmp, { recursive: true })
  } catch {
    // 没有 fixture 目录也可以跑
  }

  const action = createTypeCheckAction(
    { fileSystemProvider: () => NodeFileSystem.fileSystemProvider() },
    createBridgeGlobalsTypes(),
  )

  const failures = []
  const skipped = []
  let checked = 0
  let warned = 0
  let fileSeq = 0
  try {
    for (const rel of await collectFiles()) {
      const text = await fs.readFile(path.join(ROOT, rel), 'utf8')
      const blocks = extractBlocks(text)
      for (let idx = 0; idx < blocks.length; idx++) {
        const block = blocks[idx]
        if (block.mode === 'skip') {
          skipped.push({ rel, ...block })
          continue
        }
        // 文件名必须全局唯一：Langium 按 URI 缓存文档，同名会拿到上一份的解析结果
        const file = path.join(tmp, `${fileSeq++}_${idx}.ooc`)
        await fs.writeFile(file, block.code, 'utf8')
        let diagnostics = []
        try {
          diagnostics = await action.checkPath(file)
        } catch (err) {
          failures.push({
            rel,
            block,
            items: [{ line: block.startLine, severity: 'error', message: String(err?.message ?? err) }],
          })
          checked++
          continue
        }
        const errors = diagnostics.filter((d) => d.severity === 1)
        checked++
        // 故意演示诊断的块：只要求不出现 error
        if (block.mode === 'warning' && errors.length === 0) {
          warned++
          continue
        }
        // 严格模式：warning 也算失败——缺 `;` 常常只报一条「调用参数不匹配」，
        // 示例注释里的值已经被悄悄改写了
        const bad = block.mode === 'warning' ? errors : diagnostics
        if (bad.length) {
          failures.push({
            rel,
            block,
            items: bad.map((d) => ({
              line: block.startLine + d.range.start.line,
              severity: d.severity === 1 ? 'error' : 'warning',
              message: d.message,
            })),
          })
        }
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }

  for (const f of failures) {
    for (const item of f.items) {
      console.log(`${f.rel}:${item.line}  [${item.severity}] ${item.message}`)
    }
  }

  const total = checked + skipped.length
  console.log(
    `\n文档代码块：${total} 个，检查 ${checked} 个（通过 ${checked - failures.length}），` +
      `跳过 ${skipped.length} 个${warned ? `，允许诊断 ${warned} 个` : ''}。`,
  )
  if (failures.length) {
    console.log(`\n${failures.length} 个代码块有问题：缺 \`;\` 或示例与语法不符。`)
    process.exit(1)
  }
}

await main()
