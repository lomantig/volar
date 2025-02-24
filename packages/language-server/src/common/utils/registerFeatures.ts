import * as embedded from '@volar/language-service';
import { DiagnosticModel, LanguageServerPlugin, LanguageServerInitializationOptions } from '../../types';
import * as vscode from 'vscode-languageserver';
import { ClientCapabilities } from 'vscode-languageserver';

// https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide#standard-token-types-and-modifiers
export const semanticTokensLegend: vscode.SemanticTokensLegend = {
	tokenTypes: [
		'namespace',
		'class',
		'enum',
		'interface',
		'struct',
		'typeParameter',
		'type',
		'parameter',
		'variable',
		'property',
		'enumMember',
		'decorator',
		'event',
		'function',
		'method',
		'macro',
		'label',
		'comment',
		'string',
		'keyword',
		'number',
		'regexp',
		'operator',
	],
	tokenModifiers: [
		'declaration',
		'definition',
		'readonly',
		'static',
		'deprecated',
		'abstract',
		'async',
		'modification',
		'documentation',
		'defaultLibrary',
	],
};

export function setupSyntacticCapabilities(
	params: ClientCapabilities,
	server: vscode.ServerCapabilities,
	initOptions: LanguageServerInitializationOptions,
) {
	if (!initOptions.respectClientCapabilities || params.textDocument?.selectionRange) {
		server.selectionRangeProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.foldingRange) {
		server.foldingRangeProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.linkedEditingRange) {
		server.linkedEditingRangeProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.colorProvider) {
		server.colorProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.documentSymbol) {
		server.documentSymbolProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.formatting) {
		server.documentFormattingProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.rangeFormatting) {
		server.documentRangeFormattingProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.onTypeFormatting) {
		// https://github.com/microsoft/vscode/blob/ce119308e8fd4cd3f992d42b297588e7abe33a0c/extensions/typescript-language-features/src/languageFeatures/formatting.ts#L99
		server.documentOnTypeFormattingProvider = {
			firstTriggerCharacter: ';',
			moreTriggerCharacter: ['}', '\n'],
		};
	}
}

export function setupSemanticCapabilities(
	params: ClientCapabilities,
	server: vscode.ServerCapabilities,
	initOptions: LanguageServerInitializationOptions,
	plugins: ReturnType<LanguageServerPlugin>[],
) {
	if (!initOptions.respectClientCapabilities || params.textDocument?.references) {
		server.referencesProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.implementation) {
		server.implementationProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.definition) {
		server.definitionProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.typeDefinition) {
		server.typeDefinitionProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.callHierarchy) {
		server.callHierarchyProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.hover) {
		server.hoverProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.rename) {
		server.renameProvider = {
			prepareProvider: true,
		};
	}
	if (!initOptions.respectClientCapabilities || params.workspace?.fileOperations) {
		server.workspace = {
			fileOperations: {
				willRename: {
					filters: [
						...plugins.map(plugin => plugin.extraFileExtensions.map(ext => ({ pattern: { glob: `**/*.${ext.extension}` } }))).flat(),
						{ pattern: { glob: '**/*.js' } },
						{ pattern: { glob: '**/*.cjs' } },
						{ pattern: { glob: '**/*.mjs' } },
						{ pattern: { glob: '**/*.ts' } },
						{ pattern: { glob: '**/*.cts' } },
						{ pattern: { glob: '**/*.mts' } },
						{ pattern: { glob: '**/*.jsx' } },
						{ pattern: { glob: '**/*.tsx' } },
						{ pattern: { glob: '**/*.json' } },
					]
				}
			}
		};
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.signatureHelp) {
		server.signatureHelpProvider = {
			triggerCharacters: ['(', ',', '<'],
			retriggerCharacters: [')'],
		};
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.completion) {
		server.completionProvider = {
			// triggerCharacters: '!@#$%^&*()_+-=`~{}|[]\:";\'<>?,./ '.split(''), // all symbols on keyboard
			// hardcode to fix https://github.com/sublimelsp/LSP-volar/issues/114
			triggerCharacters: [...new Set([
				'/', '-', ':', // css
				...'>+^*()#.[]$@-{}'.split(''), // emmet
				'.', ':', '<', '"', '=', '/', // html, vue
				'@', // vue-event
				'"', ':', // json
				'.', '"', '\'', '`', '/', '<', '@', '#', ' ', // typescript
				'*', // typescript-jsdoc
				'@', // typescript-comment
			])],
			resolveProvider: true,
		};
		if (initOptions.ignoreTriggerCharacters) {
			server.completionProvider.triggerCharacters = server.completionProvider.triggerCharacters
				?.filter(c => !initOptions.ignoreTriggerCharacters!.includes(c));
		}
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.documentHighlight) {
		server.documentHighlightProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.documentLink) {
		server.documentLinkProvider = {
			resolveProvider: false, // TODO
		};
	}
	if (!initOptions.respectClientCapabilities || params.workspace?.symbol) {
		server.workspaceSymbolProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.codeLens) {
		server.codeLensProvider = {
			resolveProvider: true,
		};
		server.executeCommandProvider = { commands: [...server.executeCommandProvider?.commands ?? []] };
		// @ts-expect-error
		if (!initOptions.__noPluginCommands) {
			server.executeCommandProvider.commands.push(embedded.executePluginCommand);
		}
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.semanticTokens) {
		server.semanticTokensProvider = {
			range: true,
			full: false,
			legend: semanticTokensLegend,
		};
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.codeAction) {
		server.codeActionProvider = {
			codeActionKinds: [
				vscode.CodeActionKind.Empty,
				vscode.CodeActionKind.QuickFix,
				vscode.CodeActionKind.Refactor,
				vscode.CodeActionKind.RefactorExtract,
				vscode.CodeActionKind.RefactorInline,
				vscode.CodeActionKind.RefactorRewrite,
				vscode.CodeActionKind.Source,
				vscode.CodeActionKind.SourceFixAll,
				vscode.CodeActionKind.SourceOrganizeImports,
			],
			resolveProvider: true,
		};
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.inlayHint) {
		server.inlayHintProvider = true;
	}
	if (!initOptions.respectClientCapabilities || params.textDocument?.diagnostic && (initOptions.diagnosticModel ?? DiagnosticModel.Push) === DiagnosticModel.Pull) {
		server.diagnosticProvider = {
			documentSelector: [
				...plugins.map(plugin => plugin.extraFileExtensions.map(ext => ({ pattern: `**/*.${ext.extension}` }))).flat(),
				{ pattern: '**/*.{ts,js,tsx,jsx}' },
			],
			interFileDependencies: true,
			workspaceDiagnostics: false,
		};
	}
}
