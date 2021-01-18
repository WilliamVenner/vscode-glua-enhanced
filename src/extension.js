const WikiProvider = require("./wikiProvider");
const CompletionProvider = require("./completionProvider");
const SignatureProvider = require("./signatureProvider");
const HoverProvider = require("./hoverProvider");
const ColorProvider = require("./colorProvider");

class GLua {
	constructor(extension) {
		console.time("vscode-glua")
		console.log("vscode-glua loading...");

		this.extension = extension;

		new WikiProvider(this);
		new SignatureProvider(this);
		new CompletionProvider(this);
		new HoverProvider(this);
		new ColorProvider(this);

		console.log("vscode-glua activated");
		console.timeEnd("vscode-glua")
	}
}

module.exports = {
	activate: (extension) => new GLua(extension),
	deactivate: () => {}
};