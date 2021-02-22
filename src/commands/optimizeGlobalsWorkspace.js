const vscode = require("vscode");
const { GlobalsOptimizer, RE_FILE_NAME } = require("../globalsOptimizer.js");
const { GLuaParser } = require("../gluaparse.js");

var shown_proposed_api_error = false;

module.exports = ['glua-enhanced.optimizeGlobalsWorkspace', function() {
	vscode.window.showInformationMessage("How would you like to localize global calls?\n\nGreedy: local net_Start = net.Start\nLazy: local net = net\n\nLua functions cannot have more than 60 upvalues (locals) in their scope. \"Greedy\" may cause this error in particularly large files.", { modal: true },"Greedy", "Lazy").then(opt => {
		if (!opt) return;
		vscode.window.showInformationMessage("What files would you like to optimize the global calls of?", { modal: true },"Entire Workspace", "Open Files", "Closed Files").then(filter => {
			if (!opt) return;
			new Promise(resolve => {
				if (filter !== "Open Files") {
					vscode.workspace.findFiles("**/*.lua").then(results => {
						if (!results || results.length === 0) {
							vscode.window.showErrorMessage("No Lua files found in this workspace!");
							return;
						}
						if (filter === "Closed Files") {
							let filter = {};
							vscode.workspace.textDocuments.forEach(textDocument => {
								if (GLuaParser.isParseableTextDocument(textDocument))
									filter[textDocument.uri] = true;
							});
							resolve(results.filter(uri => !(uri.fsPath in filter)));
						} else {
							resolve(results);
						}
					});
				} else {
					if (vscode.workspace.textDocuments.length === 0) {
						vscode.window.showErrorMessage("No open Lua files!");
						return;
					}
					let results = [];
					try {
						vscode.window.openEditors.forEach(editorTab => {
							if (editorTab.resource.fsPath.match(RE_FILE_NAME))
								results.push(editorTab.resource);
						});
					} catch(e) {
						if (e.message.indexOf("proposed") !== -1) {
							if (!shown_proposed_api_error) vscode.window.showInformationMessage("VSCode has not yet released the proposed active text editor tabs API, so unfortunately we might have missed some of your open files.\nIf any files are unchanged that shouldn't be, click their respective tabs to \"open\" the documents and try again. If you really need this for whatever reason, you can use the VSCode Insiders build (which can be installed separately from VSCode Stable.)");
						} else debugger;

						vscode.workspace.textDocuments.forEach(textDocument => {
							if (GLuaParser.isParseableTextDocument(textDocument))
								results.push(textDocument.uri);
						});
					}
					resolve(results);
				}
			}).then(results => GlobalsOptimizer.optimizeBulk(
				this.GLua,
				results,
				opt === "Greedy"
			));
		});
	});
}]