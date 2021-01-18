const vscode = require("vscode");

const REGEXP_COLOR = /(?<!\.|:)\b((?:surface\.Set(?:Draw|Text)|render\.(?:SetShadow|Fog)|mesh\.)?Color|render\.(?:Clear|SetColorModulation))(\s*\(\s*)((?<r>\d+(?:\.\d+)?)\s*,\s*(?<g>\d+(?:\.\d+)?)\s*,\s*(?<b>\d+(?:\.\d+)?)(?:\s*,\s*(?<a>\d+(?:\.\d+)?))?\s*)(?:\)|,.+\)$)/g;
const REGEXP_COLOR_VECTOR = /(:Set(?:Weapon|Player)Color\s*\(\s*Vector\s*\(\s*)((?<r>\d+(?:\.\d+)?),\s*(?<g>\d+(?:\.\d+)?),\s*(?<b>\d+(?:\.\d+)?))\s*\)\s*\)/g;
const REGEXP_COLOR_MARKDOWN = /(<\s*colou?r\s*=\s*)((?<r>\d+),\s*(?<g>\d+),\s*(?<b>\d+)(?:,\s*(?<a>\d+))?)\s*>/g;
const REGEXP_COLOR_REPLACER = /(\d+(?:\.\d+)?)(\s*,\s*)(\d+(?:\.\d+)?)(\s*,\s*)(\d+(?:\.\d+)?)(?:(\s*,\s*)(\d+(?:\.\d+)?))?/;
const COLOR_ALPHA_INVALID = { "render.SetColorModulation": true };
const COLOR_ALPHA_REQUIRED = { "render.Clear": true };
const COLOR_NORMALIZED_RANGE = { "render.SetColorModulation": true };

class ColorProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.ColorProvider = this;

		this.registerSubscriptions();
	}

	registerSubscriptions() {
		this.GLua.extension.subscriptions.push(vscode.languages.registerColorProvider("glua", this));
	}

	provideColorPresentations(color, ctx) {
		let metadata = this.documentColorMetadata[ctx.document.offsetAt(ctx.range.start)];
		let normalize = metadata && (metadata.vector || (metadata.func && metadata.func in COLOR_NORMALIZED_RANGE));
		let r = normalize ? this.roundNormalizedColorComponent(color.red) : (color.red * 255).toFixed(0);
		let g = normalize ? this.roundNormalizedColorComponent(color.green) : (color.green * 255).toFixed(0);
		let b = normalize ? this.roundNormalizedColorComponent(color.blue) : (color.blue * 255).toFixed(0);
		let a = ((metadata && metadata.func && metadata.func in COLOR_ALPHA_REQUIRED) || color.alpha != 1) && (!metadata || !metadata.vector) ? (normalize ? this.roundNormalizedColorComponent(color.alpha) : (color.alpha * 255).toFixed(0)) : undefined;

		let result = ctx.document.getText(ctx.range).match(REGEXP_COLOR_REPLACER);

		let s = "";
		for (let i = 1; i <= 5; i++) {
			switch(i) {
				case 1:
					s += r;
					break;
				
				case 3:
					s += g;
					break;

				case 5:
					s += b;
					break;
				
				default:
					s += result[i];
					break;
			}
		}
		if (a) s += (result[6] ? result[6] : (result[4] ? result[4] : ", ")) + a;

		return [ new vscode.ColorPresentation(s) ];
	}

	createColorInformation(range, color, document, vector, func) {
		if (document) {
			this.documentColorMetadata[document.offsetAt(range.start)] = {
				vector: vector ? true : undefined,
				func: func
			}
		}
		return new vscode.ColorInformation(range, color);
	}

	roundNormalizedColorComponent(component) {
		return Math.round((Number(component) + Number.EPSILON) * 1000) / 1000;
	}

	provideDocumentColors(document) {
		this.documentColorMetadata = {};
		let documentColors = [];

		for (var i = 0; i < document.lineCount; i++) {
			let line = document.lineAt(i).text;

			// reset match positions
			REGEXP_COLOR.lastIndex = 0;
			REGEXP_COLOR_VECTOR.lastIndex = 0;
			REGEXP_COLOR_MARKDOWN.lastIndex = 0;

			var result;
			while ((result = REGEXP_COLOR.exec(line)) !== null) {
				if (result[1] in COLOR_ALPHA_INVALID && result.groups["a"] != undefined) continue;
				if (result[1] in COLOR_ALPHA_REQUIRED && result.groups["a"] == undefined) continue;

				let scalar = result[1] in COLOR_NORMALIZED_RANGE ? 1 : 255;
				documentColors.push(this.createColorInformation(
					new vscode.Range(i, result.index + result[1].length + result[2].length, i, result.index + result[1].length + result[2].length + result[3].length),
					new vscode.Color(result.groups["r"] / scalar, result.groups["g"] / scalar, result.groups["b"] / scalar, result.groups["a"] != undefined ? (result.groups["a"] / scalar) : 1),
					document,
					false,
					result[1]
				));
			}

			var result;
			while ((result = REGEXP_COLOR_VECTOR.exec(line)) !== null) {
				documentColors.push(this.createColorInformation(
					new vscode.Range(i, result.index + result[1].length, i, result.index + result[1].length + result[2].length),
					new vscode.Color(result.groups["r"], result.groups["g"], result.groups["b"], result.groups["a"] != undefined ? result.groups["a"] : 1),
					document,
					true
				));
			}

			var result;
			while ((result = REGEXP_COLOR_MARKDOWN.exec(line)) !== null) {
				documentColors.push(this.createColorInformation(
					new vscode.Range(i, result.index + result[1].length, i, result.index + result[1].length + result[2].length),
					new vscode.Color(result.groups["r"] / 255, result.groups["g"] / 255, result.groups["b"] / 255, result.groups["a"] != undefined ? (result.groups["a"] / 255) : 1)
				));
			}
		}

		return documentColors;
	}
}

module.exports = ColorProvider;