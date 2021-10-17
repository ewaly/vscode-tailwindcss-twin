// @ts-ignore TS/7016
import * as vscode from "vscode"
// @ts-ignore TS/7016
import * as languageFacts from "vscode-css-languageservice/lib/esm/languageFacts/facts"
// @ts-ignore TS/7016
import * as nodes from "vscode-css-languageservice/lib/esm/parser/cssNodes"
// @ts-ignore TS/7016
import { Parser } from "vscode-css-languageservice/lib/esm/parser/cssParser"
import { createToken, Token } from "./twin-parser/token"

const parser = new Parser()

export enum ColorTokenKind {
	Identifier,
	HexValue,
	Function,
}

interface ColorIdentifier {
	kind: ColorTokenKind.Identifier
	raw: Token
}

interface ColorHexValue {
	kind: ColorTokenKind.HexValue
	raw: Token
}

interface ColorFunction {
	kind: ColorTokenKind.Function
	fnName: string
	args: string[]
	raw: Token
}

export type ColorToken = ColorIdentifier | ColorHexValue | ColorFunction

export function isColorIdentifier(c: ColorToken): c is ColorIdentifier {
	return c.kind === ColorTokenKind.Identifier
}

export function isColorHexValue(c: ColorToken): c is ColorHexValue {
	return c.kind === ColorTokenKind.HexValue
}

export function isColorFunction(c: ColorToken): c is ColorFunction {
	return c.kind === ColorTokenKind.Function
}

export default function extractColors(value: string): ColorToken[] {
	const colors: ColorToken[] = []
	const node = parser.internalParse(value, parser._parseExpr.bind(parser))
	if (!node) return colors
	// @ts-ignore TS/7016
	node.accept(node => {
		switch (node.type) {
			case nodes.NodeType.Identifier: {
				if (node.parent?.type !== nodes.NodeType.Term) break
				const color = node.getText().toLowerCase()
				if (color === "transparent") {
					colors.push({
						raw: createToken(node.offset, node.offset + node.length, color),
						kind: ColorTokenKind.Identifier,
					})
				} else if (color in languageFacts.colors) {
					colors.push({
						raw: createToken(node.offset, node.offset + node.length, color),
						kind: ColorTokenKind.Identifier,
					})
				}
				break
			}
			case nodes.NodeType.HexColorValue: {
				const color = node.getText()
				if (/(^#[0-9A-F]{8}$)|(^#[0-9A-F]{6}$)|(^#[0-9A-F]{4}$)|(^#[0-9A-F]{3}$)/i.test(color)) {
					colors.push({
						raw: createToken(node.offset, node.offset + node.length, color),
						kind: ColorTokenKind.HexValue,
					})
				}
				break
			}
			case nodes.NodeType.Function: {
				const fnName: string = node.getName()
				if (fnName && /^(rgb|rgba|hsl|hsla)/i.test(fnName)) {
					let args: string[] = node
						.getArguments()
						.getChildren() // @ts-ignore TS/7016
						.map(token => value.substr(token.offset, token.length))

					if (args.length === 1) {
						args = args[0].split(/\s+/).filter(t => t && t !== "/")
					}

					if (args.length < 3) break

					colors.push({
						kind: ColorTokenKind.Function,
						fnName,
						args,
						raw: createToken(
							node.offset,
							node.offset + node.length,
							value.substr(node.offset, node.length),
						),
					})
				}
				break
			}
		}
		return true
	})
	return colors
}

const Digit0 = 48
const Digit9 = 57
const A = 65
const a = 97
const f = 102

export function hexDigit(charCode: number | undefined) {
	if (!charCode) return 0
	if (charCode < Digit0) return 0
	if (charCode <= Digit9) return charCode - Digit0
	if (charCode < a) charCode += a - A
	if (charCode >= a && charCode <= f) return charCode - a + 10
	return 0
}

export function colorFromHex(c: ColorHexValue): vscode.Color {
	const text = c.raw.value
	switch (text.length) {
		case 4:
			return {
				red: (hexDigit(text.charCodeAt(1)) * 0x11) / 255.0,
				green: (hexDigit(text.charCodeAt(2)) * 0x11) / 255.0,
				blue: (hexDigit(text.charCodeAt(3)) * 0x11) / 255.0,
				alpha: 1,
			}
		case 5:
			return {
				red: (hexDigit(text.charCodeAt(1)) * 0x11) / 255.0,
				green: (hexDigit(text.charCodeAt(2)) * 0x11) / 255.0,
				blue: (hexDigit(text.charCodeAt(3)) * 0x11) / 255.0,
				alpha: (hexDigit(text.charCodeAt(4)) * 0x11) / 255.0,
			}
		case 7:
			return {
				red: (hexDigit(text.charCodeAt(1)) * 0x10 + hexDigit(text.charCodeAt(2))) / 255.0,
				green: (hexDigit(text.charCodeAt(3)) * 0x10 + hexDigit(text.charCodeAt(4))) / 255.0,
				blue: (hexDigit(text.charCodeAt(5)) * 0x10 + hexDigit(text.charCodeAt(6))) / 255.0,
				alpha: 1,
			}
	}
	return {
		red: (hexDigit(text.charCodeAt(1)) * 0x10 + hexDigit(text.charCodeAt(2))) / 255.0,
		green: (hexDigit(text.charCodeAt(3)) * 0x10 + hexDigit(text.charCodeAt(4))) / 255.0,
		blue: (hexDigit(text.charCodeAt(5)) * 0x10 + hexDigit(text.charCodeAt(6))) / 255.0,
		alpha: (hexDigit(text.charCodeAt(7)) * 0x10 + hexDigit(text.charCodeAt(8))) / 255.0,
	}
}

export function colorFromIdentifier(c: ColorIdentifier): vscode.Color {
	if (c.raw.value === "transparent") {
		return { red: 0, green: 0, blue: 0, alpha: 0 }
	}
	const hexValue = languageFacts.colors[c.raw.value]
	return colorFromHex({ kind: ColorTokenKind.HexValue, raw: createToken(0, 0, hexValue) })
}

export function getNumericValue(value: string | undefined, factor: number) {
	if (!value) return NaN
	const match = value.match(/^([-+]?[0-9]*\.?[0-9]+)(%?)$/)
	if (!match) return NaN
	if (match) {
		if (match[2]) {
			factor = 100.0
		}
		const result = parseFloat(match[1]) / factor
		if (result >= 0 && result <= 1) {
			return result
		}
	}
	return NaN
}

export function getAngle(value: string | undefined) {
	if (!value) return NaN
	const match = value.match(/^([-+]?[0-9]*\.?[0-9]+)(deg)?$/) // TODO: rad, grad or turns
	if (match) {
		return parseFloat(value) % 360
	}
	return NaN
}

export function colorFromHSL(hue: number, sat: number, light: number, alpha = 1.0): vscode.Color {
	hue = hue / 60.0
	if (sat === 0) {
		return { red: light, green: light, blue: light, alpha }
	} else {
		const t2 = light <= 0.5 ? light * (sat + 1) : light + sat - light * sat
		const t1 = light * 2 - t2
		return { red: hueToRgb(t1, t2, hue + 2), green: hueToRgb(t1, t2, hue), blue: hueToRgb(t1, t2, hue - 2), alpha }
	}

	function hueToRgb(t1: number, t2: number, hue: number) {
		while (hue < 0) {
			hue += 6
		}
		while (hue >= 6) {
			hue -= 6
		}

		if (hue < 1) {
			return (t2 - t1) * hue + t1
		}
		if (hue < 3) {
			return t2
		}
		if (hue < 4) {
			return (t2 - t1) * (4 - hue) + t1
		}
		return t1
	}
}

export function colorFromFunction(c: ColorFunction): vscode.Color | undefined {
	const alpha = c.args.length === 4 ? getNumericValue(c.args[3], 1) : 1
	if (c.fnName === "rgb" || c.fnName === "rgba") {
		return {
			red: getNumericValue(c.args[0], 255.0),
			green: getNumericValue(c.args[1], 255.0),
			blue: getNumericValue(c.args[2], 255.0),
			alpha,
		}
	} else if (c.fnName === "hsl" || c.fnName === "hsla") {
		const h = getAngle(c.args[0])
		const s = getNumericValue(c.args[1], 100.0)
		const l = getNumericValue(c.args[2], 100.0)
		return colorFromHSL(h, s, l, alpha)
	}
	return undefined
}
