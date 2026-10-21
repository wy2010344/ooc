// tsgen 端到端测试共享工具：.ooc 源编译到临时目录、加载产物与共享 runtime。
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileAction } from 'object-oriented-c-cli'

/** Node ≥23.6 才有原生类型剥离，可直接 import 生成的 .ts */
export const CAN_RUN = Number(process.versions.node.split('.')[0]) >= 23

/** 把 .ooc 源编译到临时目录，返回入口产物路径 */
export async function compileSource(
  name: string,
  source: string,
): Promise<{ ts: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-'))
  const srcPath = path.join(dir, `${name}.ooc`)
  await fs.writeFile(srcPath, source, 'utf-8')
  await compileAction(srcPath, { destination: dir })
  return { ts: path.join(dir, `${name}.ts`), dir }
}

/** 共享 runtime：产物从它 import __send/__spread/__mutable */
export async function loadRuntime(dir: string): Promise<any> {
  return import(pathToFileURL(path.join(dir, '_ooc_runtime.ts')).href)
}
