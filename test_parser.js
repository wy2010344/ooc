const { createObjectOrientedCServices } = await import(
  './packages/language/out/index.js'
)
const { EmptyFileSystem } = await import('langium')
const services = createObjectOrientedCServices(EmptyFileSystem)
const { parseHelper } = await import('langium/test')
const parse = parseHelper(services.ObjectOrientedC)

const code = `
  obj = {
    method(a, a) => a add a
  };
`

const document = await parse(code, { validation: true })
console.log('Parse errors:', document.parseResult.parserErrors.length)
console.log('Diagnostics:', document.diagnostics?.length || 0)
document.diagnostics?.forEach((d) => console.log('  -', d.message))
