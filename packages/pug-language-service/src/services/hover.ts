import { transformHover } from '@volar/transforms';
import type * as html from 'vscode-html-languageservice';
import { MappingKind } from '../baseParse';
import type { PugDocument } from '../pugDocument';

export function register(htmlLs: html.LanguageService) {
	return (pugDoc: PugDocument, pos: html.Position, options?: html.HoverSettings | undefined) => {

		const htmlPos = pugDoc.map.toGeneratedPosition(pos, data => data !== MappingKind.EmptyTagCompletion);
		if (!htmlPos)
			return;

		const htmlResult = htmlLs.doHover(
			pugDoc.map.mappedDocument,
			htmlPos,
			pugDoc.htmlDocument,
			options,
		);
		if (!htmlResult) return;

		return transformHover(htmlResult, htmlRange => pugDoc.map.toSourceRange(htmlRange));
	};
}
