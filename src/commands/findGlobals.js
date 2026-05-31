const vscode = require("vscode");
const escape = require("markdown-escape");

const noop = () => {};

function getDefinitionLink(token) {
	let uri = typeof token.uri === "string" ? vscode.Uri.file(token.uri) : token.uri;
	let line = token.loc.start.line;
	let column = token.loc.start.column + 1;
	let path = uri.path;
	return `vscode://file${path}:${line}:${column}`;
}

module.exports = ['glua-enhanced.findGlobals', function() {
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
				let link = getDefinitionLink(token);
				definitions += `[${escape(relPath)}](${link}) (Line ` + token.loc.start.line + (token.loc.start.column > 0 ? (":" + token.loc.start.column) : "") + ")<br>";
			}

			compiled += "\n| " + escape(name) + " | " + definitions.replace(/<br>$/, "") + " |";
		}

		this.GLua.createTempFile("glua_enhanced_globals.md", (new TextEncoder()).encode(compiled)).then(([path]) => {
			let previewUri = vscode.Uri.file(path).with({ query: Date.now().toString() });
			vscode.commands.executeCommand("markdown.showPreview", previewUri).then(noop, (err) => {
				vscode.window.showErrorMessage("Error: " + err);
			});
		});
	}
}];