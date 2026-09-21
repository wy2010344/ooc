import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createObjectOrientedCServices } from 'object-oriented-c-language';
import { createBridgeGlobalsTypes } from 'ooc-mve-bridge';

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services, with bridge types for type checking
const { shared } = createObjectOrientedCServices(
  { connection, ...NodeFileSystem },
  undefined,
  createBridgeGlobalsTypes(),
);

// Start the language server with the shared services
startLanguageServer(shared);
