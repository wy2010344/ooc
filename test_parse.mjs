import {
  createObjectOrientedCServices,
  executeOOC,
} from './packages/language/out/index.js'
import { EmptyFileSystem } from 'langium'
import { parseHelper } from 'langium/test'

const services = createObjectOrientedCServices(EmptyFileSystem)
const parse = parseHelper(services.ObjectOrientedC)

const code = `t = true;
            f = false;
            t and f`
const doc = await parse(code)
console.log('ParseErrors:', doc.parseResult.parserErrors?.length)
if (doc.parseResult.parserErrors?.length) {
  doc.parseResult.parserErrors.forEach((e, i) => {
    console.log(`Error ${i}:`, e.message)
  })
}
console.log(
  'beforeExpressions:',
  doc.parseResult.value?.beforeExpressions?.length,
)
console.log('expression type:', doc.parseResult.value?.expression?.$type)

executeOOC(doc.parseResult.value)
