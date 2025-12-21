const { createObjectOrientedCServices, executeOOC } = await import(
  './packages/language/out/index.js'
)
const { EmptyFileSystem } = await import('langium')
const services = createObjectOrientedCServices(EmptyFileSystem)
const { parseHelper } = await import('langium/test')
const parse = parseHelper(services.ObjectOrientedC)

const code = `
  x = 42;
`

const document = await parse(code)
console.log('\n=== DEBUG ===')
const model = document.parseResult.value
console.log('Model:', model ? 'defined' : 'undefined')
console.log('Items count:', model?.items?.length || 0)

if (model?.items?.[0]) {
  const item = model.items[0]
  console.log('Item 0 type:', item.$type)
  console.log('Item 0 value:', item.value)
  console.log('Item 0 value.$type:', item.value?.$type)

  if (item.$type === 'VarDeclaration') {
    const expr = item.value
    console.log('\nExpression type:', expr?.$type)
    console.log('Expression is Pipeline?', expr?.$type === 'Pipeline')
    if (expr?.$type === 'Pipeline') {
      console.log('Pipeline.messageChain:', expr.messageChain)
      console.log('MessageChain.$type:', expr.messageChain?.$type)
      console.log('MessageChain.primary:', expr.messageChain?.primary)
      console.log('Primary.$type:', expr.messageChain?.primary?.$type)
    }
  }
}

// Now interpret
const result = executeOOC(model)
console.log('\nResult:', result)
