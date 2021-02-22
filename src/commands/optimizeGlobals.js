const vscode = require("vscode");
const GlobalsOptimizer = require("../globalsOptimizer.js");

module.exports = ['glua-enhanced.optimizeGlobals', function() {
	if (!vscode.window.activeTextEditor) {
		vscode.window.showErrorMessage("No active text editor!");
	} else {
		vscode.window.activeTextEditor.edit(editBuilder => {
			GlobalsOptimizer.optimize(
				this.GLua,
				editBuilder,
				this.GLua.GLuaParser.getParsed(vscode.window.activeTextEditor.document.uri, vscode.window.activeTextEditor.document)
			).then(vscode.workspace.applyEdit);
		});
	}
}]