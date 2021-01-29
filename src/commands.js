const vscode = require("vscode");
const escape = require("markdown-escape");

const noop = () => {};

class Commands {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.Commands = this;

		this.registerCommands(this);
	}

	registerCommands(Commands) {
		vscode.commands.registerCommand("glua-enhanced.findGlobals", () => Commands.findGlobals());
		vscode.commands.registerCommand("glua-enhanced.bytecodeHeatmap", () => Commands.bytecodeHeatmap());
	}

	bytecodeHeatmap() {
		if (!vscode.window.activeTextEditor) {
			vscode.window.showErrorMessage("No active text editor!");
		} else {
			this.GLua.BytecodeHeatmapProvider.generateHeatmap(vscode.window.activeTextEditor);
		}
	}

	findGlobals() {
		let globals = Object.keys(this.GLua.TokenIntellisenseProvider.compiledTokenData._G);
		if (globals.length === 0) {
			vscode.window.showInformationMessage("No globals found!");
		} else {
			globals = globals.sort();
			
			let compiled = "# Defined Globals\n\n| Name | Definition(s) |\n|-|-|";

			for (let i = 0; i < globals.length; i++) {
				let name = globals[i];
				let tokens = this.GLua.TokenIntellisenseProvider.compiledTokenData._G[name];
				if (tokens.length === 0) continue;

				let definitions = "";
				for (let i = 0; i < tokens.length; i++) {
					let token = tokens[i];
					let relPath = vscode.workspace.asRelativePath(token.uri);
					definitions += `[${relPath}](/${relPath}) (Line ` + token.loc.start.line + (token.loc.start.column > 0 ? (":" + token.loc.start.column) : "") + ")<br>";
				}

				compiled += "\n| " + escape(name) + " | " + definitions.replace(/<br>$/, "") + " |";
			}

			this.GLua.createTempFile("glua_enhanced_globals.md", (new TextEncoder()).encode(compiled)).then(([path]) => {
				vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(path)).then(noop, (err) => {
					vscode.window.showErrorMessage("Error: " + err);
				});
			});
		}
	}
}

module.exports = Commands;