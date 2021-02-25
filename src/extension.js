const vscode = require("vscode");

const WikiProvider = require("./wikiProvider");
const { GLuaParser } = require("./gluaparse");
const { CompletionProvider } = require("./completionProvider");
const SignatureProvider = require("./signatureProvider");
const HoverProvider = require("./hoverProvider");
const ColorProvider = require("./colorProvider");
const TypesProvider = require("./typesProvider");
const DefinitionProvider = require("./definitionProvider");
const Commands = require("./commands");
const TempFile = require("./tempFile");
const BytecodeHeatmapProvider = require("./bytecodeHeatmapProvider");
const ReferenceProvider = require("./referenceProvider");
const VMTProvider = require("./vmtProvider");

class GLua {
	constructor(extension) {
		console.time("vscode-glua")
		console.log("vscode-glua loading...");

		this.extension = extension;
		this.tmpFiles = {};

		new GLuaParser(this);
		new WikiProvider(this);
		new SignatureProvider(this);
		new CompletionProvider(this);
		new ReferenceProvider(this);
		new HoverProvider(this);
		new ColorProvider(this);
		new TypesProvider(this);
		new DefinitionProvider(this);
		new VMTProvider(this);
		new BytecodeHeatmapProvider(this);
		new Commands(this);

		console.log("vscode-glua activated");
		console.timeEnd("vscode-glua");

		console.time("vscode-glua-workspace-parse");
		this.GLuaParser.parseWorkspace().then((parsedFiles) => {
			this.TokenIntellisenseProvider.compileTokenData();

			console.log("vscode-glua parsed " + Object.keys(parsedFiles).length + " workspace Lua file(s)");
			console.timeEnd("vscode-glua-workspace-parse");
		});

		this.registerEvents(this);
	}

	registerEvents(GLua) {
		vscode.workspace.onDidCloseTextDocument((textDocument) => GLua.onDidCloseTextDocument(textDocument));
	}

	createTempFile(name, contents) {
		return (new TempFile(this, name, contents)).create();
	}

	openTempFile(name) {
		return (new TempFile(this, name, -1)).create();
	}

	onDidCloseTextDocument(textDocument) {
		if (textDocument.uri.fsPath in this.tmpFiles) {
			this.tmpFiles[textDocument.uri.fsPath].dispose();
		}
	}
}

module.exports = {
	activate: (extension) => new GLua(extension),
	deactivate: () => {}
};