import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createObjectOrientedCServices } from 'object-oriented-c-language';

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Bridge/全局类型不再由扩展内置注入：各项目在自己的 config.ooc 里通过
// globals 成员声明（ConfigAwareDocumentValidator 校验时按目录动态注入）。
const { shared } = createObjectOrientedCServices({
  connection,
  ...NodeFileSystem,
});

// Start the language server with the shared services
startLanguageServer(shared);
