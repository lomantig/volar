import { DocumentRegistry, VirtualFile, forEachEmbeddeds, PositionCapabilities, TeleportMappingData } from '@volar/language-core';
import * as shared from '@volar/shared';
import { Mapping, SourceMapBase } from '@volar/source-map';
import ts = require('typescript');
import * as vscode from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';

export type SourceFileDocuments = ReturnType<typeof parseSourceFileDocuments>;
export type SourceFileDocument = NonNullable<ReturnType<ReturnType<typeof parseSourceFileDocuments>['get']>>;

export class SourceMap<Data = undefined> extends SourceMapBase<Data> {

	constructor(
		public sourceDocument: TextDocument,
		public mappedDocument: TextDocument,
		public mappings: Mapping<Data>[],
	) {
		super(mappings);
	}

	// Range APIs

	public toSourceRange(range: vscode.Range, filter: (data: Data) => boolean = () => true) {
		for (const result of this.toSourceRanges(range, filter)) {
			return result;
		}
	}

	public toGeneratedRange(range: vscode.Range, filter: (data: Data) => boolean = () => true) {
		for (const result of this.toGeneratedRanges(range, filter)) {
			return result;
		}
	}

	public * toSourceRanges(range: vscode.Range, filter: (data: Data) => boolean = () => true) {
		for (const result of this.toRanges(range, filter, 'toSourcePositionsBase', 'matchSourcePosition')) {
			yield result;
		}
	}

	public * toGeneratedRanges(range: vscode.Range, filter: (data: Data) => boolean = () => true) {
		for (const result of this.toRanges(range, filter, 'toGeneratedPositionsBase', 'matchGeneratedPosition')) {
			yield result;
		}
	}

	protected * toRanges(
		range: vscode.Range,
		filter: (data: Data) => boolean,
		api: 'toSourcePositionsBase' | 'toGeneratedPositionsBase',
		api2: 'matchSourcePosition' | 'matchGeneratedPosition'
	) {
		const failedLookUps: (readonly [vscode.Position, Mapping<Data>])[] = [];
		for (const mapped of this[api](range.start, filter, 'left')) {
			const end = this[api2](range.end, mapped[1], 'right');
			if (end) {
				yield { start: mapped[0], end } as vscode.Range;
			}
			else {
				failedLookUps.push(mapped);
			}
		}
		for (const failedLookUp of failedLookUps) {
			for (const mapped of this[api](range.end, filter, 'right')) {
				yield { start: failedLookUp[0], end: mapped[0] } as vscode.Range;
			}
		}
	}

	// Position APIs

	public toSourcePosition(position: vscode.Position, filter: (data: Data) => boolean = () => true, baseOffset: 'left' | 'right' = 'left') {
		for (const mapped of this.toSourcePositions(position, filter, baseOffset)) {
			return mapped;
		}
	}

	public toGeneratedPosition(position: vscode.Position, filter: (data: Data) => boolean = () => true, baseOffset: 'left' | 'right' = 'left') {
		for (const mapped of this.toGeneratedPositions(position, filter, baseOffset)) {
			return mapped;
		}
	}

	public * toSourcePositions(position: vscode.Position, filter: (data: Data) => boolean = () => true, baseOffset: 'left' | 'right' = 'left') {
		for (const mapped of this.toSourcePositionsBase(position, filter, baseOffset)) {
			yield mapped[0];
		}
	}

	public * toGeneratedPositions(position: vscode.Position, filter: (data: Data) => boolean = () => true, baseOffset: 'left' | 'right' = 'left') {
		for (const mapped of this.toGeneratedPositionsBase(position, filter, baseOffset)) {
			yield mapped[0];
		}
	}

	public toSourcePositionsBase(position: vscode.Position, filter: (data: Data) => boolean = () => true, baseOffset: 'left' | 'right' = 'left') {
		return this.toPositions(position, filter, this.mappedDocument, this.sourceDocument, 'generatedRange', 'sourceRange', baseOffset);
	}

	public toGeneratedPositionsBase(position: vscode.Position, filter: (data: Data) => boolean = () => true, baseOffset: 'left' | 'right' = 'left') {
		return this.toPositions(position, filter, this.sourceDocument, this.mappedDocument, 'sourceRange', 'generatedRange', baseOffset);
	}

	protected * toPositions(
		position: vscode.Position,
		filter: (data: Data) => boolean,
		fromDoc: TextDocument,
		toDoc: TextDocument,
		from: 'sourceRange' | 'generatedRange',
		to: 'sourceRange' | 'generatedRange',
		baseOffset: 'left' | 'right',
	) {
		for (const mapped of this.matcing(fromDoc.offsetAt(position), from, to, baseOffset === 'right')) {
			if (!filter(mapped[1].data)) {
				continue;
			}
			let offset = mapped[0];
			const mapping = mapped[1];
			if (baseOffset === 'right') {
				offset += (mapping.sourceRange[1] - mapping.sourceRange[0]) - (mapping.generatedRange[1] - mapping.generatedRange[0]);
			}
			yield [toDoc.positionAt(offset), mapping] as const;
		}
	}

	protected matchSourcePosition(position: vscode.Position, mapping: Mapping, baseOffset: 'left' | 'right') {
		let offset = this.matchOffset(this.mappedDocument.offsetAt(position), mapping['generatedRange'], mapping['sourceRange'], baseOffset === 'right');
		if (offset !== undefined) {
			return this.sourceDocument.positionAt(offset);
		}
	}

	protected matchGeneratedPosition(position: vscode.Position, mapping: Mapping, baseOffset: 'left' | 'right') {
		let offset = this.matchOffset(this.sourceDocument.offsetAt(position), mapping['sourceRange'], mapping['generatedRange'], baseOffset === 'right');
		if (offset !== undefined) {
			return this.mappedDocument.positionAt(offset);
		}
	}
}

export class EmbeddedDocumentSourceMap extends SourceMap<PositionCapabilities> {

	constructor(
		public rootFile: VirtualFile,
		public file: VirtualFile,
		public sourceDocument: TextDocument,
		public mappedDocument: TextDocument,
		mappings: Mapping<PositionCapabilities>[],
	) {
		super(sourceDocument, mappedDocument, mappings);
	}
}

export class TeleportSourceMap extends SourceMap<TeleportMappingData> {
	constructor(
		public file: VirtualFile,
		public document: TextDocument,
		mappings: Mapping<TeleportMappingData>[],
	) {
		super(document, document, mappings);
	}
	*findTeleports(start: vscode.Position) {
		for (const mapped of this.toGeneratedPositionsBase(start)) {
			yield [mapped[0], mapped[1].data.toGenedCapabilities] as const;
		}
		for (const mapped of this.toSourcePositionsBase(start)) {
			yield [mapped[0], mapped[1].data.toSourceCapabilities] as const;
		}
	}
}

export function parseSourceFileDocuments(mapper: DocumentRegistry) {

	let version = 0;

	const snapshotsToMaps = new WeakMap<ts.IScriptSnapshot, {
		fileName: string,
		snapshot: ts.IScriptSnapshot,
		document: TextDocument,
		file: VirtualFile,
		maps: Map<VirtualFile, EmbeddedDocumentSourceMap>,
		teleports: Map<VirtualFile, TeleportSourceMap>,
	}>();

	return {
		get: (uri: string) => {

			const fileName = shared.getPathOfUri(uri);
			const virtualFile = mapper.get(fileName);

			if (virtualFile) {
				return getMaps(fileName, virtualFile[0], virtualFile[1]);
			}
		},
		getTeleport(virtualFileUri: string) {
			const fileName = shared.getPathOfUri(virtualFileUri);
			const source = mapper.getSourceByVirtualFileName(fileName);
			if (source) {
				const maps = getMaps(source[0], source[1], source[2]);
				for (const [_, teleport] of maps.teleports) {
					if (teleport.file.fileName.toLowerCase() === fileName.toLowerCase()) {
						return teleport;
					}
				}
			}
		},
		getMap(virtualFileUri: string) {
			const fileName = shared.getPathOfUri(virtualFileUri);
			const source = mapper.getSourceByVirtualFileName(fileName);
			if (source) {
				const maps = getMaps(source[0], source[1], source[2]);
				for (const [_, map] of maps.maps) {
					if (map.file.fileName.toLowerCase() === fileName.toLowerCase()) {
						return map;
					}
				}
			}
		},
	};

	function getMaps(fileName: string, snapshot: ts.IScriptSnapshot, rootFile: VirtualFile) {

		let result = snapshotsToMaps.get(snapshot);

		if (!result) {

			const document = TextDocument.create(
				shared.getUriByPath(fileName),
				'vue',
				version++,
				snapshot.getText(0, snapshot.getLength()),
			);
			const maps = new Map<VirtualFile, EmbeddedDocumentSourceMap>();
			const teleports = new Map<VirtualFile, TeleportSourceMap>();

			forEachEmbeddeds(rootFile, file => {
				const virtualFileDocument = TextDocument.create(
					shared.getUriByPath(file.fileName),
					shared.syntaxToLanguageId(file.fileName.substring(file.fileName.lastIndexOf('.') + 1)),
					version++,
					file.text,
				);
				maps.set(file, new EmbeddedDocumentSourceMap(
					rootFile,
					file,
					document,
					virtualFileDocument,
					file.mappings,
				));
				if (file.teleportMappings) {
					teleports.set(file, new TeleportSourceMap(
						file,
						virtualFileDocument,
						file.teleportMappings,
					));
				}
			});

			result = {
				fileName,
				snapshot,
				document,
				file: rootFile,
				maps,
				teleports,
			};
			snapshotsToMaps.set(snapshot, result);
		}

		return result;
	}
}
