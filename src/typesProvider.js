const vscode = require("vscode");
const { GLuaParser, TokenAnalyzer } = require("./gluaparse");

class TypesProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.docs = this.GLua.WikiProvider.docs;

		const hintStyle = {
			color: new vscode.ThemeColor("glua_enhanced.typeHints.color"),
			fontStyle: "normal",
			fontWeight: "normal",
			textDecoration: "none; font-size: smaller"
		};
		this.typeHint = vscode.window.createTextEditorDecorationType({
			after: hintStyle, before: hintStyle
		});

		this.typeHintCache = new Map();

		this.registerEvents(this);
		
		if (vscode.window.activeTextEditor && GLuaParser.isParseableTextDocument(vscode.window.activeTextEditor.document)) {
			this.scanTypes(vscode.window.activeTextEditor, this.GLua.GLuaParser.getParsed(vscode.window.activeTextEditor.document.uri, vscode.window.activeTextEditor.document))
		}
	}

	registerEvents(TypesProvider) {
		this.GLua.GLuaParser.onFileParsed((fsPath, parsed) => TypesProvider.onFileParsedEvent(fsPath, parsed));
	}

	onFileParsedEvent(fsPath, parsed) {
		if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath === fsPath) {
			this.scanTypes(vscode.window.activeTextEditor, parsed);
			return;
		}

		for (let i = 0; i < vscode.window.visibleTextEditors.length; i++) {
			if (vscode.window.visibleTextEditors[i].document.uri.fsPath === fsPath) {
				this.scanTypes(vscode.window.visibleTextEditors[i], parsed);
				return;
			}
		}
	}

	disposeCache(textEditor) {
		if (!this.typeHintCache.has(textEditor)) return;
		this.typeHintCache.delete(textEditor);
	}
	
	addHint(textEditor, where, pos, type) {
		let renderOptions = {};
		if (where === "before") {
			renderOptions[where] = { contentText: "\u{200C}" + type + ": \u{200c}" };
		} else if (where === "after") {
			renderOptions[where] = { contentText: "\u{200C}: " + type + "\u{200c}" };
		} else {
			throw new Error("No hint position specified");
		}
		this.typeHintCache.get(textEditor).push({
			renderOptions,
			range: new vscode.Range(pos, pos)
		});
	}

	addHookParameters(textEditor, parameterTokens, hookArguments) {
		for (let i = 0; i < Math.min(parameterTokens.length, hookArguments.length); i++) {
			let hookArg = hookArguments[i];
			if (!("TYPE" in hookArg) && !("NAME" in hookArg)) continue;

			let paramToken = parameterTokens[i];
			
			this.addHint(
				textEditor,
				"before",
				new vscode.Position(paramToken.loc.start.line-1, paramToken.loc.start.column),
				"TYPE" in hookArg ? hookArg.TYPE : hookArg.NAME
			);
		}
	}

	scanTypes(textEditor, parsed) {
		if (!textEditor) return;

		this.disposeCache(textEditor);

		if (!parsed || !("CallExpression" in parsed.TYPES)) return;

		this.typeHintCache.set(textEditor, []);
		for (let i = 0; i < parsed.TYPES["CallExpression"].LIST.length; i++) {
			let token = parsed.TYPES["CallExpression"].LIST[i];
			let func_call = TokenAnalyzer.getFullFunctionCall(token);
			if ("arguments" in token && token.arguments.length === 3 && func_call.length === 3 && func_call.join("") === "hook.Add") {
				let hook_func = token.arguments[2];
				if (hook_func.type !== "FunctionDeclaration") continue;

				let hook_name = TokenAnalyzer.parseStringLiteral(token.arguments[0]);
				if (!hook_name) continue;
			
				let tag = "HOOK:GM:" + hook_name;
				if (tag in this.docs) {
					const selfArg = token.arguments[1].type !== "StringLiteral" ? {NAME: "self"} : false;
					
					let hasHookArguments = false;
					if (hook_func.parameters.length > 0) {
						let hookArguments = "ARGUMENTS" in this.docs[tag] && this.docs[tag].ARGUMENTS.length > 0 ? this.docs[tag].ARGUMENTS : undefined;
						if (hookArguments) {
							hasHookArguments = true;
							if (selfArg) {
								hookArguments = [selfArg, ...hookArguments];
							}
							this.addHookParameters(textEditor, hook_func.parameters, hookArguments);
						}
					}
					if (!hasHookArguments && selfArg) {
						this.addHookParameters(textEditor, hook_func.parameters, [selfArg]);
					}

					let hookReturns = "RETURNS" in this.docs[tag] && this.docs[tag].RETURNS.length > 0 ? this.docs[tag].RETURNS : undefined;
					if (hookReturns) {
						let paramEnd = (hook_func.parameters && hook_func.parameters.length > 0) ? hook_func.parameters[hook_func.parameters.length-1].loc.end : hook_func.loc.start;
						let searchRange = new vscode.Range(paramEnd.line-1, paramEnd.column, hook_func.loc.end.line-1, hook_func.loc.end.column);
						this.addHint(textEditor, "after", searchRange.start.translate(0, textEditor.document.getText(searchRange).indexOf(")") + 1), this.GLua.SignatureProvider.generateSignatureString(hookReturns));
					}
				}
			}
		}

		this.setDecorations(textEditor);
	}

	setDecorations(textEditor) {
		if (!this.typeHintCache.has(textEditor)) {
			textEditor.setDecorations(this.typeHint, []);
		} else {
			textEditor.setDecorations(this.typeHint, this.typeHintCache.get(textEditor));
		}
	}
}

module.exports = TypesProvider;