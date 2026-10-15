import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createObjectOrientedCServices } from 'object-oriented-c-language';
import { createBridgeGlobalsTypes } from 'ooc-mve-bridge/types';

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// 注册表（Route A）：宿主包类型源（language 内置 + ooc-mve-bridge）先行解析，
// 项目 config.ooc 的 globals 成员只列名，RHS 裸名从注册表解析出真实类型。
// 项目本地类型（未入注册表的）仍可在 config.ooc 顶层声明形状。
const globalsTypes = createBridgeGlobalsTypes();

const { shared } = createObjectOrientedCServices(
  {
    connection,
    ...NodeFileSystem,
  },
  undefined,
  globalsTypes,
);

// Start the language server with the shared services
startLanguageServer(shared);
