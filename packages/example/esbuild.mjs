// esbuild 构建脚本（替换 vite）：.ooc 用 text loader 打进 bundle，CSS 自动打包
import * as esbuild from 'esbuild'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const isServe = process.argv.includes('--serve')

const context = await esbuild.context({
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  outdir: path.join(root, 'dist/assets'),
  absWorkingDir: root,
  loader: { '.ooc': 'text' },
  format: 'esm',
  target: ['es2022'],
  sourcemap: true,
  logLevel: 'info',
})

await context.rebuild()
await fs.mkdir(path.join(root, 'dist'), { recursive: true })
await fs.copyFile(
  path.join(root, 'index.html'),
  path.join(root, 'dist', 'index.html'),
)

if (isServe) {
  const { port } = await context.serve({ servedir: 'dist', port: 5173 })
  console.log(`dev server: http://localhost:${port}`)
  while (true) await new Promise((resolve) => setTimeout(resolve, 3600_000))
} else {
  await context.dispose()
}
