import type { OOCModel } from 'object-oriented-c-language'
import { expandToNode, toString } from 'langium/generate'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { extractDestinationAndName } from './util.js'

export function generateJavaScript(
  model: OOCModel,
  filePath: string,
  destination: string | undefined
): string {
  const data = extractDestinationAndName(filePath, destination)
  const generatedFilePath = `${path.join(data.destination, data.name)}.js`

  const fileNode = expandToNode`
        "use strict";

        // Generated from Object-Oriented C
        // This is a placeholder implementation
        console.log("Generated from Object-Oriented C");
    `.appendNewLineIfNotEmpty()

  if (!fs.existsSync(data.destination)) {
    fs.mkdirSync(data.destination, { recursive: true })
  }
  fs.writeFileSync(generatedFilePath, toString(fileNode))
  return generatedFilePath
}
