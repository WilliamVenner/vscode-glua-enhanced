const vscode = require("vscode");
const GlobalsOptimizer = require("../globalsOptimizer.js");

module.exports = ['glua-enhanced.optimizeGlobalsWorkspace', function() {
	vscode.workspace.findFiles("**/*.lua").then(results => {
		if (!results || results.length === 0) {
			vscode.window.showErrorMessage("No Lua files found in this workspace!");
			return;
		}

		GlobalsOptimizer.optimizeBulk(this.GLua, results);
	});
}]