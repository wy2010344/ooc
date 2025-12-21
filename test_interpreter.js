const { createObjectOrientedCServices } = await import(
  './packages/language/out/index.js'
)
const { EmptyFileSystem } = await import('langium')
const services = createObjectOrientedCServices(EmptyFileSystem)
const { parseHelper } = await import('langium/test')
const parse = parseHelper(services.ObjectOrientedC)
const { executeOOC } = await import('./packages/language/out/index.js')

const code = `
  x = 42;
`

const document = await parse(code)
console.log(
  'parseResult:',
  document.parseResult.value ? 'defined' : 'undefined'
)
console.log('parseResult.$type:', document.parseResult.value?.$type)
console.log('items:', document.parseResult.value?.items?.length || 0)
if (document.parseResult.value?.items?.length) {
  const item = document.parseResult.value.items[0]
  console.log('first item $type:', item.$type)
  console.log('first item name:', item.name)
  console.log('first item value:', item.value)
}

const result = executeOOC(document.parseResult.value)
console.log('result:', result)
