// 语句块代码生成：块内绑定平铺 const；只有 RHS 引用同名外层绑定时才套块隔离。
import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileAction } from 'object-oriented-c-cli'

const CAN_RUN = Number(process.versions.node.split('.')[0]) >= 23

/** 编译 .ooc 源码到临时目录，返回产物 .ts 路径与代码文本 */
async function compileSource(name: string, source: string): Promise<{ ts: string; code: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ooc-tsgen-scope-'))
  const srcPath = path.join(dir, `${name}.ooc`)
  await fs.writeFile(srcPath, source, 'utf-8')
  await compileAction(srcPath, { destination: dir })
  const ts = path.join(dir, `${name}.ts`)
  return { ts, code: await fs.readFile(ts, 'utf-8') }
}

test('块内多条赋值平铺 const，不再逐条套作用域', async (t) => {
  const { ts, code } = await compileSource(
    'flat',
    `obj = {
    m(x) {
        t = x + 1;
        u = t * 2;
        u
    }
};
obj m 3`,
  )
  if (!/const t = [^;]+; const u = [^;]+; return u/.test(code)) {
    throw new Error(`多条赋值应平铺为 const 序列，实际：\n${code}`)
  }
  if (code.includes('__v')) throw new Error(`无同名遮蔽时不应生成中间量：\n${code}`)
  if (!CAN_RUN) return t.skip('Node <23 无原生类型擦除')
  const mod = await import(pathToFileURL(ts).href)
  if (mod.default !== 8) throw new Error(`(3+1)*2 应为 8，实际 ${mod.default}`)
})

test('RHS 引用同名外层绑定时先求值再声明（lambda 遮蔽）', async (t) => {
  const { ts, code } = await compileSource(
    'shadow',
    `obj = {
    m(x) {
        f = [n => x = x + 1; x];
        f $ 0
    }
};
obj m 3`,
  )
  if (!code.includes('__v0')) {
    throw new Error(`同名遮蔽应另起块求值 RHS，实际：\n${code}`)
  }
  if (!CAN_RUN) return t.skip('Node <23 无原生类型擦除')
  const mod = await import(pathToFileURL(ts).href)
  if (mod.default !== 4) throw new Error(`外层 x=3 遮蔽后应得 4，实际 ${mod.default}`)
})
