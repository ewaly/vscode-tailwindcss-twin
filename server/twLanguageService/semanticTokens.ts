import { TextDocument } from "vscode-languageserver-textdocument"
import * as lsp from "vscode-languageserver"
import chroma from "chroma-js"
import { Tailwind } from "~/tailwind"
import type { ServiceOptions } from "~/twLanguageService"
import * as tw from "~/common/twin"
import { findAllMatch, PatternKind } from "~/common/ast"
import parseSemanticTokens, { NodeType, Node } from "~/common/parseSemanticTokens"
import parseThemeValue, { TwThemeElementKind } from "~/common/parseThemeValue"

// https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide#semantic-token-classification

enum SemanticKind {
	keyword,
	number,
	interface,
	variable,
	function,
	enumMember,
	operator,
}

enum BlockKind {
	Variant = SemanticKind.interface,
	Classname = SemanticKind.enumMember,
	CssProperty = SemanticKind.function,
	Brackets = SemanticKind.variable,
	Important = SemanticKind.operator,
}

export default function provideSemanticTokens(
	document: TextDocument,
	state: Tailwind,
	{ colorDecorators }: ServiceOptions,
): lsp.SemanticTokens {
	const builder = new lsp.SemanticTokensBuilder()
	const tokens = findAllMatch(document)

	for (const { token, kind } of tokens) {
		const [start, , value] = token

		const getPosition = (offset: number) => document.positionAt(start + offset)

		if (kind === PatternKind.TwinTheme) {
			renderThemeValue(token, getPosition, builder, state, colorDecorators)
			continue
		}

		const isValidClass = (variants: string[], value: string) =>
			state.classnames.isClassName(variants, kind === PatternKind.Twin, value)

		const isValidVariant = (variant: string) =>
			state.classnames.isVariant(variant, kind === PatternKind.Twin || kind === PatternKind.TwinCssProperty)

		const canRender = (node: Node) => {
			if (kind === PatternKind.TwinCssProperty) {
				return true
			}
			if (!colorDecorators) return true
			if (node.kind === NodeType.Class) {
				const color = state.classnames.getColorInfo(node.value.text)
				if (!color || Object.keys(color).length === 0) {
					return true
				}
				if (
					(!!color.backgroundColor && color.backgroundColor !== "currentColor") ||
					(!!color.color && color.color !== "currentColor")
				) {
					return false
				}
			}
			return true
		}

		renderClasses(kind, isValidClass, isValidVariant, canRender, getPosition, builder, parseSemanticTokens(value))
	}
	return builder.build()
}

function renderClasses(
	kind: PatternKind,
	isValidClass: (variants: string[], value: string) => boolean,
	isValidVariant: (variant: string) => boolean,
	canRender: (node: Node) => boolean,
	getPosition: (offset: number) => lsp.Position,
	builder: lsp.SemanticTokensBuilder,
	blocks: ReturnType<typeof parseSemanticTokens>,
	context = tw.createTokenList(),
) {
	for (const node of blocks) {
		for (const variant of node.variants) {
			if (!isValidVariant(variant.text)) {
				continue
			}
			const pos = getPosition(variant.start)
			const len = variant.end - variant.start
			builder.push(pos.line, pos.character, len + 1, BlockKind.Variant, 0)
		}

		if (node.kind === NodeType.Group) {
			const pos = getPosition(node.lbrace)
			builder.push(pos.line, pos.character, 1, BlockKind.Brackets, 0)
		}

		if (node.kind === NodeType.Class) {
			if (
				kind === PatternKind.Twin &&
				isValidClass(tw.createTokenList([...context, ...node.variants]).texts, node.value.text)
			) {
				if (canRender(node)) {
					const pos = getPosition(node.value.start)
					builder.push(pos.line, pos.character, node.value.end - node.value.start, BlockKind.Classname, 0)
				}
			}
		} else if (node.kind === NodeType.CssProperty) {
			const pos = getPosition(node.value.start)
			builder.push(pos.line, pos.character, node.value.end - node.value.start, BlockKind.CssProperty, 0)
		} else if (node.kind === NodeType.Group && node.children.length > 0) {
			renderClasses(
				kind,
				isValidClass,
				isValidVariant,
				canRender,
				getPosition,
				builder,
				node.children,
				tw.createTokenList([...context, ...node.variants]),
			)
		}

		if (node.kind === NodeType.Group && typeof node.rbrace === "number") {
			const pos = getPosition(node.rbrace)
			builder.push(pos.line, pos.character, 1, BlockKind.Brackets, 0)
		}

		if (node.kind === NodeType.Group || node.kind === NodeType.Class || node.kind === NodeType.CssProperty) {
			if (typeof node.important === "number") {
				const pos = getPosition(node.important)
				builder.push(pos.line, pos.character, 1, BlockKind.Important, 0)
			}
		}
	}
}

function parseColor(value: unknown): string | undefined {
	if (typeof value === "string") {
		if (value === "transparent") {
			return value
		}
		try {
			const c = chroma(value)
			return c.css()
		} catch {
			return undefined
		}
	}
	return undefined
}

function renderThemeValue(
	token: tw.Token,
	getPosition: (offset: number) => lsp.Position,
	builder: lsp.SemanticTokensBuilder,
	state: Tailwind,
	colorDecorators: boolean,
) {
	const result = parseThemeValue(token.text)

	const value = state.getTheme(result.keys())
	const c = parseColor(value)

	if (c && colorDecorators) {
		return
	}

	for (const node of result.blocks) {
		const [a, b] = node.token
		const pos = getPosition(a)
		if (node.kind === TwThemeElementKind.Identifier || node.kind === TwThemeElementKind.BracketIdentifier) {
			builder.push(pos.line, pos.character, b - a, SemanticKind.number, 0)
		} else {
			builder.push(pos.line, pos.character, 1, SemanticKind.variable, 0)
		}
	}
}
