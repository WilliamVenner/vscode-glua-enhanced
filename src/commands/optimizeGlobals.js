const vscode = require("vscode");
const { GlobalsOptimizer } = require("../globalsOptimizer.js");

module.exports = ['glua-enhanced.optimizeGlobals', function() {
	if (!vscode.window.activeTextEditor) {
		vscode.window.showErrorMessage("No active text editor!");
	} else {
		vscode.window.showInformationMessage("How would you like to localize global calls?\n\nGreedy: local net_Start = net.Start\nLazy: local net = net\n\nLua functions cannot have more than 60 upvalues (locals) in their scope. \"Greedy\" may cause this error in particularly large files.", { modal: true }, "Greedy", "Lazy").then(opt => {
			if (!opt) return;
			vscode.window.activeTextEditor.edit(editBuilder => {
				GlobalsOptimizer.optimize(
					opt === "Greedy",
					editBuilder,
					this.GLua.GLuaParser.getParsed(vscode.window.activeTextEditor.document.uri, vscode.window.activeTextEditor.document)
				).then(vscode.workspace.applyEdit);
			});
		});
	}
}]