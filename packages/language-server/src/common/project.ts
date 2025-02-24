import * as embedded from '@volar/language-core';
import * as embeddedLS from '@volar/language-service';
import * as shared from '@volar/shared';
import * as path from 'typesafe-path';
import type * as ts from 'typescript/lib/tsserverlibrary';
import * as html from 'vscode-html-languageservice';
import * as vscode from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { FileSystem, LanguageServerPlugin } from '../types';
import { createUriMap } from './utils/uriMap';
import { WorkspaceParams } from './workspace';
import { LanguageServicePlugin } from '@volar/language-service';

export interface ProjectParams {
	workspace: WorkspaceParams;
	rootUri: URI;
	tsConfig: path.PosixPath | ts.CompilerOptions,
	documentRegistry: ts.DocumentRegistry,
	workspacePlugins: LanguageServicePlugin[],
}

export type Project = ReturnType<typeof createProject>;

export async function createProject(params: ProjectParams) {

	const { tsConfig, documentRegistry, rootUri } = params;
	const { ts, fileSystemHost, documents, cancelTokenHost, tsLocalized, initOptions, configurationHost } = params.workspace.workspaces;
	const { plugins } = params.workspace.workspaces;
	const { runtimeEnv } = params.workspace.workspaces.server;
	const sys = fileSystemHost.getWorkspaceFileSystem(rootUri);

	let typeRootVersion = 0;
	let projectVersion = 0;
	let projectVersionUpdateTime = cancelTokenHost.getMtime();
	let vueLs: embeddedLS.LanguageService | undefined;
	let parsedCommandLine = createParsedCommandLine(ts, sys, shared.getPathOfUri(rootUri.toString()), tsConfig, plugins);

	const scripts = createUriMap<{
		version: number,
		fileName: string,
		snapshot: ts.IScriptSnapshot | undefined,
		snapshotVersion: number | undefined,
	}>();
	const languageServiceHost = createLanguageServiceHost();

	const disposeWatchEvent = fileSystemHost.onDidChangeWatchedFiles(params => {
		onWorkspaceFilesChanged(params.changes);
	});
	const disposeDocChange = documents.onDidChangeContent(() => {
		projectVersion++;
		projectVersionUpdateTime = cancelTokenHost.getMtime();
	});

	return {
		tsConfig,
		scripts,
		languageServiceHost,
		getLanguageService,
		getLanguageServiceDontCreate: () => vueLs,
		getParsedCommandLine: () => parsedCommandLine,
		tryAddFile: (fileName: string) => {
			if (!parsedCommandLine.fileNames.includes(fileName)) {
				parsedCommandLine.fileNames.push(fileName);
				projectVersion++;
			}
		},
		dispose,
	};

	function getLanguageService() {
		if (!vueLs) {

			const languageModules = plugins.map(plugin => plugin.semanticService?.getLanguageModules?.(languageServiceHost) ?? []).flat();
			const languageContext = embedded.createEmbeddedLanguageServiceHost(languageServiceHost, languageModules);
			const languageServiceContext = embeddedLS.createLanguageServiceContext({
				host: languageServiceHost,
				context: languageContext,
				getPlugins() {
					return [
						...params.workspacePlugins,
						...plugins.map(plugin => plugin.semanticService?.getServicePlugins?.(languageServiceHost, vueLs!) ?? []).flat(),
					];
				},
				env: {
					rootUri,
					configurationHost: configurationHost,
					fileSystemProvider: runtimeEnv.fileSystemProvide,
					documentContext: getHTMLDocumentContext(ts, languageServiceHost),
					schemaRequestService: async uri => {
						const protocol = uri.substring(0, uri.indexOf(':'));
						const builtInHandler = runtimeEnv.schemaRequestHandlers[protocol];
						if (builtInHandler) {
							return await builtInHandler(uri);
						}
						return '';
					},
				},
				documentRegistry,
			});
			vueLs = embeddedLS.createLanguageService(languageServiceContext);
		}
		return vueLs;
	}
	async function onWorkspaceFilesChanged(changes: vscode.FileEvent[]) {

		for (const change of changes) {

			const script = scripts.uriGet(change.uri);

			if (script && (change.type === vscode.FileChangeType.Changed || change.type === vscode.FileChangeType.Created)) {
				if (script.version >= 0) {
					script.version = -1;
				}
				else {
					script.version--;
				}
			}
			else if (script && change.type === vscode.FileChangeType.Deleted) {
				scripts.uriDelete(change.uri);
			}

			if (script) {
				projectVersion++;
			}
		}

		const creates = changes.filter(change => change.type === vscode.FileChangeType.Created);
		const deletes = changes.filter(change => change.type === vscode.FileChangeType.Deleted);

		if (creates.length || deletes.length) {
			parsedCommandLine = createParsedCommandLine(ts, sys, shared.getPathOfUri(rootUri.toString()), tsConfig, plugins);
			projectVersion++;
			typeRootVersion++;
		}
	}
	function createLanguageServiceHost() {

		const token: ts.CancellationToken = {
			isCancellationRequested() {
				return cancelTokenHost.getMtime() !== projectVersionUpdateTime;
			},
			throwIfCancellationRequested() { },
		};
		let host: embedded.LanguageServiceHost = {
			// ts
			getNewLine: () => sys.newLine,
			useCaseSensitiveFileNames: () => sys.useCaseSensitiveFileNames,
			readFile: sys.readFile,
			writeFile: sys.writeFile,
			directoryExists: sys.directoryExists,
			getDirectories: sys.getDirectories,
			readDirectory: sys.readDirectory,
			realpath: sys.realpath,
			fileExists: sys.fileExists,
			getCurrentDirectory: () => shared.getPathOfUri(rootUri.toString()),
			getProjectReferences: () => parsedCommandLine.projectReferences, // if circular, broken with provide `getParsedCommandLine: () => parsedCommandLine`
			getCancellationToken: () => token,
			// custom
			getDefaultLibFileName: options => {
				try {
					return ts.getDefaultLibFilePath(options);
				} catch {
					// web
					return initOptions.typescript.tsdk + '/' + ts.getDefaultLibFileName(options);
				}
			},
			getProjectVersion: () => projectVersion.toString(),
			getTypeRootsVersion: () => typeRootVersion,
			getScriptFileNames: () => parsedCommandLine.fileNames,
			getCompilationSettings: () => parsedCommandLine.options,
			getScriptVersion,
			getScriptSnapshot,
			getTypeScriptModule: () => ts,
		};

		if (initOptions.noProjectReferences) {
			host.getProjectReferences = undefined;
			host.getCompilationSettings = () => ({
				...parsedCommandLine.options,
				rootDir: undefined,
				composite: false,
			});
		}

		if (tsLocalized) {
			host.getLocalizedDiagnosticMessages = () => tsLocalized;
		}

		for (const plugin of plugins) {
			if (plugin.semanticService?.resolveLanguageServiceHost) {
				host = plugin.semanticService.resolveLanguageServiceHost(ts, sys, tsConfig, host);
			}
		}

		return host;

		function getScriptVersion(fileName: string) {

			const doc = documents.data.pathGet(fileName);
			if (doc) {
				return doc.version.toString();
			}

			return scripts.pathGet(fileName)?.version.toString() ?? '';
		}
		function getScriptSnapshot(fileName: string) {

			const doc = documents.data.pathGet(fileName);
			if (doc) {
				return doc.getSnapshot();
			}

			const script = scripts.pathGet(fileName);
			if (script && script.snapshotVersion === script.version) {
				return script.snapshot;
			}

			if (sys.fileExists(fileName)) {
				if (initOptions.maxFileSize) {
					const fileSize = sys.getFileSize?.(fileName);
					if (fileSize !== undefined && fileSize > initOptions.maxFileSize) {
						console.warn(`IGNORING "${fileName}" because it is too large (${fileSize}bytes > ${initOptions.maxFileSize}bytes)`);
						return ts.ScriptSnapshot.fromString('');
					}
				}
				const text = sys.readFile(fileName, 'utf8');
				if (text !== undefined) {
					const snapshot = ts.ScriptSnapshot.fromString(text);
					if (script) {
						script.snapshot = snapshot;
						script.snapshotVersion = script.version;
					}
					else {
						scripts.pathSet(fileName, {
							version: -1,
							fileName: fileName,
							snapshot: snapshot,
							snapshotVersion: -1,
						});
					}
					return snapshot;
				}
			}
		}
	}
	function dispose() {
		vueLs?.dispose();
		scripts.clear();
		disposeWatchEvent();
		disposeDocChange();
	}
}

function createParsedCommandLine(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	sys: FileSystem,
	rootPath: path.PosixPath,
	tsConfig: path.PosixPath | ts.CompilerOptions,
	plugins: ReturnType<LanguageServerPlugin>[],
): ts.ParsedCommandLine {
	const extraFileExtensions = plugins.map(plugin => plugin.extraFileExtensions).flat();
	try {
		let content: ts.ParsedCommandLine;
		if (typeof tsConfig === 'string') {
			const config = ts.readJsonConfigFile(tsConfig, sys.readFile);
			content = ts.parseJsonSourceFileConfigFileContent(config, sys, path.dirname(tsConfig), {}, tsConfig, undefined, extraFileExtensions);
		}
		else {
			content = ts.parseJsonConfigFileContent({ files: [] }, sys, rootPath, tsConfig, path.join(rootPath, 'jsconfig.json' as path.PosixPath), undefined, extraFileExtensions);
		}
		// fix https://github.com/johnsoncodehk/volar/issues/1786
		// https://github.com/microsoft/TypeScript/issues/30457
		// patching ts server broke with outDir + rootDir + composite/incremental
		content.options.outDir = undefined;
		content.fileNames = content.fileNames.map(shared.normalizeFileName);
		return content;
	}
	catch {
		// will be failed if web fs host first result not ready
		return {
			errors: [],
			fileNames: [],
			options: {},
		};
	}
}

function getHTMLDocumentContext(
	ts: typeof import('typescript/lib/tsserverlibrary'),
	host: ts.LanguageServiceHost,
) {
	const documentContext: html.DocumentContext = {
		resolveReference(ref: string, base: string) {

			const isUri = base.indexOf('://') >= 0;
			const resolveResult = ts.resolveModuleName(
				ref,
				isUri ? shared.getPathOfUri(base) : base,
				host.getCompilationSettings(),
				host,
			);
			const failedLookupLocations: path.PosixPath[] = (resolveResult as any).failedLookupLocations;
			const dirs = new Set<string>();

			for (let failed of failedLookupLocations) {
				const fileName = path.basename(failed);
				if (fileName === 'index.d.ts' || fileName === '*.d.ts') {
					dirs.add(path.dirname(failed));
				}
				if (failed.endsWith('.d.ts')) {
					failed = failed.substring(0, failed.length - '.d.ts'.length) as path.PosixPath;
				}
				else {
					continue;
				}
				if (host.fileExists(failed)) {
					return isUri ? shared.getUriByPath(failed) : failed;
				}
			}
			for (const dir of dirs) {
				if (host.directoryExists?.(dir) ?? true) {
					return isUri ? shared.getUriByPath(dir) : dir;
				}
			}

			return undefined;
		},
	};
	return documentContext;
}
