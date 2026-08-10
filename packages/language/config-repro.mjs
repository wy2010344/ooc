import { createInterpretAction } from 'object-oriented-c-language'

const moduleSources = new Map([
  ['demo.ooc', `x: number = 'hello'; x`],
  ['ooc.json', `{ "diagnostics": { "unknownType": "off", "typeMismatch": "error" } }`],
])

function nameOf(uri) {
  return (decodeURIComponent(uri.path).split('/').filter(Boolean).pop() ?? '').toLowerCase()
}

const fileSystemProvider = {
  stat(uri) { return Promise.resolve({ isFile: true, isDirectory: false, uri }) },
  statSync(uri) { return { isFile: true, isDirectory: false, uri } },
  exists(uri) { return Promise.resolve(moduleSources.has(nameOf(uri))) },
  existsSync(uri) { return moduleSources.has(nameOf(uri)) },
  async readBinary() { return new Uint8Array() },
  readBinarySync() { return new Uint8Array() },
  readFile(uri) {
    const s = moduleSources.get(nameOf(uri))
    if (s == null) throw new Error(`模块不存在: ${uri.path}`)
    return Promise.resolve(s)
  },
  readFileSync() { throw new Error('不支持') },
  readDirectory() { return Promise.resolve([]) },
  readDirectorySync() { return [] },
}

const { interpretPath } = createInterpretAction(
  { fileSystemProvider: () => fileSystemProvider },
  {},
)
try {
  const v = await interpretPath('demo.ooc')
  console.log('NO ERROR (typeMismatch stayed warning):', JSON.stringify(v))
} catch (e) {
  console.log('THREW (typeMismatch escalated):')
  console.log(String(e).slice(0, 300))
}
