const vscode = require("vscode");

const { TokenAnalyzer } = require("./gluaparse");

class ReferenceProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.ReferenceProvider = this;

		this.registerSubscriptions();
	}

	registerSubscriptions() {
		this.GLua.extension.subscriptions.push(vscode.languages.registerReferenceProvider("glua", this));
	}

	provideReferences(textDocument, pos, ctx, cancel) {
		if (cancel.isCancellationRequested) return;

		let word = textDocument.getWordRangeAtPosition(pos); if (!word || word === "." || word === ":" || word === "self") return;
		word = textDocument.getText(word);

		let references = [];

		var token = this.GLua.GLuaParser.getTokenAt(textDocument, pos, "StringLiteral");
		if (token && "parent" in token) {
			let func_call = TokenAnalyzer.getFullFunctionCall(token.parent);
			if (func_call && func_call.length === 3) {
				let full_func_call = func_call.join("");
				switch(full_func_call) {
					case "net.Receive":
					case "net.Start":
					case "util.AddNetworkString":
						let networkStrings = this.GLua.GLuaParser.TokenIntellisenseProvider.compiledTokenData.references.networkStrings;
						if (token.value in networkStrings) this.pushReferences(references, networkStrings[token.value]);
						break;

					case "hook.Run":
					case "hook.Add":
					case "hook.Call":
					case "hook.Remove":
						// TODO
						break;
				}
			}
		}

		if (references.length > 0) return references;
	}

	pushReferences(references, push, uri) {
		if (!push) return;
		let isArray = Array.isArray(push);
		let i = 0;
		while (!isArray || i < push.length) {
			let push_me = isArray ? push[i] : push;

			references.push(new vscode.Location(push_me.uri || uri, new vscode.Range(push_me.loc.start.line-1, push_me.loc.start.column, push_me.loc.end.line-1, push_me.loc.end.column)));

			if (!isArray) break;
			else i++;
		}
	}

	getReferences(func_call, token, line, originSelectionRange) {
		if (func_call.length === 0) { resolve(); return; }

		let full_call = func_call.join("");

		let references = [];

		for (let i = 0; i <= 1; i++) {
			let referencesProvider = i === 1 ? (
				vscode.window.activeTextEditor &&
				vscode.window.activeTextEditor.document.uri.fsPath in this.GLua.GLuaParser.TokenIntellisenseProvider.workspaceTokenData ?
				this.GLua.GLuaParser.TokenIntellisenseProvider.workspaceTokenData[vscode.window.activeTextEditor.document.uri.fsPath].data.references : undefined
			) : this.GLua.GLuaParser.TokenIntellisenseProvider.compiledTokenData.references;
			if (!referencesProvider) continue;
			
			
		}

		if (references.length > 0) return references;
	}
}

module.exports = ReferenceProvider;