const vscode = require("vscode");

class Commands {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.Commands = this;

		this.registerCommands();
	}

	registerCommand(id, func) {
		vscode.commands.registerCommand(id, func.bind(this));
	}

	registerCommands() {
		this.registerCommand(...require("./commands/bytecodeHeatmap.js"));
		this.registerCommand(...require("./commands/findGlobals.js"));
		this.registerCommand(...require("./commands/optimizeGlobals.js"));
		this.registerCommand(...require("./commands/optimizeGlobalsWorkspace.js"));
	}
}

module.exports = Commands;