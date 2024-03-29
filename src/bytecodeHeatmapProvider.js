const child_process = require("child_process");
const fs = require("fs");
const { env } = require("process");
const vscode = require("vscode");

const { GLuaParser } = require("./gluaparse");

// Big thanks to Spar for his bytecode heatmap generator
// https://github.com/GitSparTV
// http://steamcommunity.com/profiles/76561198056741543
const { ReadChunk, MakeHeatMap, opcodesWeight } = require("./lib/spar_bytecode_heatmap");

function round2(n) {
	return Math.round((n + Number.EPSILON) * 100) / 100;
}

function easeIn(x) {
	return 1 - Math.sqrt(1 - x);
}

const LUAJIT_BYTECODE_URL = "http://wiki.luajit.org/Bytecode-2.0";
const CLOSURE_URL = "https://www.lua.org/pil/6.1.html";

class BytecodeHeatmapProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.BytecodeHeatmapProvider = this;

		this.heatmapLine = vscode.window.createTextEditorDecorationType({
			before: {
				backgroundColor: "#ff0000; position: absolute; left: 0; width: 100%; height: 100%; top: 0; z-index: -1",
				contentText: ""
			}
		});
	}

	generateHeatmap(textEditor) {
		if (!GLuaParser.isParseableTextDocument(textEditor.document)) {
			vscode.window.showErrorMessage("This isn't a valid GLua file");
			return;
		}

		let text = textEditor.document.getText();
		this.GLua.createTempFile("gluac.lua", text).then(([tmpPath, dispose]) => {
			child_process.execFile(
				this.GLua.extension.asAbsolutePath("src/lib/gluac/gluac" + (process.platform === "win32" ? ".exe" : "")), [tmpPath],
				{ windowsHide: true, encoding: "buffer", maxBuffer: (4 * text.length) + 1024, env: (process.platform === "win32" ? {} : { "LD_LIBRARY_PATH": this.GLua.extension.asAbsolutePath("src/lib/gluac") }) },
	
				(err, stdout, stderr) => {
					dispose();

					if (err || stderr.length > 0) vscode.window.showErrorMessage("Error: " + (err || stderr.toString("utf8"))); else {
						let heatMapResults;
						try {
							heatMapResults = MakeHeatMap(ReadChunk(stdout));
						} catch(err) {
							vscode.window.showErrorMessage("Bytecode error: " + err);
						}
	
						let [heatMap, maxHeat] = heatMapResults;
						
						let decorations = [];
						heatMap.forEach((lineData, line) => {
							let weight = lineData[0];
							if (weight === 0) return;
							let opCodes = lineData[1];

							let opCodeTable = "| Opcode | Count | Weight/op | Weight | % |\n|:-:|:-:|:-:|:-:|:-:|\n";
							let sortedOpCodes = [];
							for (let opCode in opCodes) {
								let count = opCodes[opCode][0];
								let cumWeight = opCodes[opCode][1];
								sortedOpCodes.push([opCode, cumWeight, count]);
							}
							sortedOpCodes.sort((a, b) => b[1] - a[1]);
							for (let i = 0; i < sortedOpCodes.length; i++) {
								let opCode = sortedOpCodes[i][0];
								let cumWeight = sortedOpCodes[i][1];
								let count = sortedOpCodes[i][2];
								opCodeTable += "| [`" + opCode + "`](" + (opCode === "CLOSURE" ? CLOSURE_URL : LUAJIT_BYTECODE_URL) + ") | " + count + " | " + round2(opcodesWeight[opCode]) + " | " + round2(cumWeight) + " | " + round2((cumWeight / weight) * 100) + "% |\n";
							}

							let docLine = textEditor.document.lineAt(line-1);
							let pos = new vscode.Position(line-1, docLine.firstNonWhitespaceCharacterIndex);
							let posLineEnd = new vscode.Position(line-1, docLine.text.length);
							let heat = weight / maxHeat;
							decorations.push({
								renderOptions: { before: { opacity: String(easeIn(heat) / 2) } },
								range: new vscode.Range(pos, posLineEnd),
								hoverMessage: new vscode.MarkdownString("Bytecode Weight: " + round2(weight) + " (File Max: " + round2(maxHeat) + ")\n\nHeat: " + round2(heat * 100) + "%" + "\n\n" + opCodeTable)
							});
						});
	
						this.setDecorations(textEditor, decorations);
					}
				}
			);
		}, (err) => vscode.window.showErrorMessage("Error: " + err));
	}

	setDecorations(textEditor, heatMap) {
		textEditor.setDecorations(this.heatmapLine, heatMap);
	}
}

module.exports = BytecodeHeatmapProvider;