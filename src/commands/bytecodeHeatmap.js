const vscode = require("vscode");

module.exports = ['glua-enhanced.bytecodeHeatmap', function() {
	if (!vscode.window.activeTextEditor) {
		vscode.window.showErrorMessage("No active text editor!");
	} else {
		this.GLua.BytecodeHeatmapProvider.generateHeatmap(vscode.window.activeTextEditor);
	}
}]