const vscode = require("vscode");

const { Tokenizer, LUA_ESCAPE_SEQUENCES } = require("./tokenizer");

const REGEXP_FUNC_CALL_TYPE = /^(.+)(:|\.)(.+?)$/;

class SignatureProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.SignatureProvider = this;

		this.signatureProviders = {
			globals: {},
			functions: {},
			metaFunctions: {}
		};

		this.registerSubscriptions();
	}

	registerSubscriptions() {
		this.GLua.extension.subscriptions.push(vscode.languages.registerSignatureHelpProvider("glua", this, "(", ","));
	}

	generateSignatureString(args) {
		let str = "";
		for (let i = 0; i < args.length; i++) {
			str += this.generateTypeSignature(args[i]) + ", "
		}
		return str.substr(0, str.length - 2);
	}

	generateTypeSignature(arg) {
		if (arg["TYPE"] === "vararg") {
			return "..."
		} else {
			return arg["NAME"] + ": " + arg["TYPE"];
		}
	}

	pushSignature(activeParameter, signatures, docs, callback, activeCallbackParameter, callbackDocumentation) {
		let docArguments = "ARGUMENTS" in docs ? "ARGUMENTS" : ("CALLBACK" in docs ? "CALLBACK" : undefined);
		if (!docArguments) return;
		docArguments = docs[docArguments];

		let arg_count = docArguments.length;
		let arg_pos = Math.min(activeParameter, arg_count-1);
		if (
			(activeParameter < arg_count || docArguments[arg_count - 1]["TYPE"] === "vararg") &&
			(!callback || !("CALLBACK" in docArguments[arg_pos]) || (docArguments[arg_pos]["TYPE"] === "function"))
		) {
			let sigInfo = new vscode.SignatureInformation(this.generateSignatureString(docArguments), callbackDocumentation ? callbackDocumentation : ("SEARCH" in docs ? this.GLua.WikiProvider.resolveDocumentation(docs, docs["SEARCH"], true) : undefined));
			sigInfo.activeParameter = arg_pos;
			for (let i = 0; i < arg_count; i++) {
				let arg = docArguments[i];
				
				let param = new vscode.ParameterInformation(this.generateTypeSignature(arg), "DESCRIPTION" in arg ? this.GLua.WikiProvider.resolveDocumentation(arg).appendMarkdown(sigInfo.documentation ? "\n\n---" : "") : undefined);
				if ("ENUM" in arg) param.ENUM = arg["ENUM"];

				if (callback && arg_pos === i) {
					let paramSignatures = [];
					this.pushSignature(activeCallbackParameter, paramSignatures, arg, undefined, undefined, sigInfo.documentation);

					param.CALLBACK_SIGNATURES = new vscode.SignatureHelp();
					param.CALLBACK_SIGNATURES.signatures = paramSignatures;
				}

				sigInfo.parameters.push(param);
			}

			signatures.push(sigInfo);
		}
	}

	pushSignatures(activeParameter, signatures, docs, callback, activeCallbackParameter) {
		if (Array.isArray(docs)) for (let i = 0; i < docs.length; i++) this.pushSignature(activeParameter, signatures, docs[i], callback, activeCallbackParameter, undefined);
		else this.pushSignature(activeParameter, signatures, docs, callback, activeCallbackParameter, undefined);
	}

	provideSignatureHelp(document, pos, cancel, ctx) {
		let line = document.lineAt(pos);
		let cursor = line.text.substr(0, pos.character);
		
		let tokenized = new Tokenizer(cursor);
		if (tokenized.invalidLua || tokenized.openParanthesis.length === 0) return;

		let func = tokenized.openParanthesis[tokenized.openParanthesis.length-1];
		if (func === false) return;

		let activeCallbackParameter;
		let callback = false;
		if (tokenized.openParanthesis.length > 1) {
			// Detect a callback function
			if (func[0] === "function") {
				callback = true;
				activeCallbackParameter = func.length - 1;
				func = tokenized.openParanthesis[tokenized.openParanthesis.length-2];
			}
		}

		let activeParameter = func.length - 1;
		let func_parse = func[0].match(REGEXP_FUNC_CALL_TYPE);

		let signatures = [];

		while (true) {
			if (!func_parse) {
				let func_name = func[0];

				// Show globals only
				if (func_name in this.signatureProviders.globals) {
					this.pushSignatures(activeParameter, signatures, this.signatureProviders.globals[func_name], callback, activeCallbackParameter);
				}
			} else {
				let full_call = func_parse[0];
				let library_or_meta = func_parse[1];
				let func_call = func_parse[2];
				let meta_func = func_parse[3];

				if (func_call === ":" && this.GLua.CompletionProvider.hookCompletions[library_or_meta]) {
					// Show hooks only
					if (full_call in this.signatureProviders.metaFunctions) {
						this.pushSignatures(activeParameter, signatures, this.signatureProviders.metaFunctions[full_call], callback, activeCallbackParameter);
					}
					break;
				}

				// Show libraries
				if (full_call in this.signatureProviders.functions) {
					if (callback && full_call == "hook.Add") {
						let hookDocTag = "GM:" + func[1];
						if (hookDocTag in this.signatureProviders.metaFunctions) {
							this.pushSignatures(activeCallbackParameter, signatures, this.signatureProviders.metaFunctions[hookDocTag]);
							break;
						}
					}
					
					this.pushSignatures(activeParameter, signatures, this.signatureProviders.functions[full_call], callback, activeCallbackParameter);
					break;
				}
				
				// Show meta functions
				if (meta_func in this.signatureProviders.metaFunctions) {
					this.pushSignatures(activeParameter, signatures, this.signatureProviders.metaFunctions[meta_func], callback, activeCallbackParameter);
					break;
				}
			}
			break;
		}

		if (signatures.length > 0) {
			if (callback) {
				let activeParam = signatures[0].parameters[activeParameter];
				if ("CALLBACK_SIGNATURES" in activeParam) {
					return activeParam.CALLBACK_SIGNATURES;
				}
			}

			let sigHelp = new vscode.SignatureHelp();
			sigHelp.signatures = signatures;
			return sigHelp;
		}
	}

	registerSignature(completionItem, tag, item_def) {
		switch(tag) {
			case "GLOBAL":
				this.signatureProviders.globals[item_def["SEARCH"]] = item_def;
				break;

			case "FUNCTION":
				this.signatureProviders.functions[item_def["SEARCH"]] = item_def;
				break;
		
			case "HOOK":
				var sigName = completionItem.label;
				if (sigName in this.signatureProviders.metaFunctions) {
					if (!Array.isArray(this.signatureProviders.metaFunctions[sigName])) {
						this.signatureProviders.metaFunctions[sigName] = [ this.signatureProviders.metaFunctions[sigName] ];
					}
					this.signatureProviders.metaFunctions[sigName].push(item_def);
				} else {
					this.signatureProviders.metaFunctions[sigName] = item_def;
				}
				// do not break

			case "META_FUNCTION":
				if (tag !== "HOOK" || (completionItem.insertText && completionItem.insertText !== completionItem.label)) {
					var sigName = completionItem.insertText || completionItem.label;
					if (sigName in this.signatureProviders.metaFunctions) {
						if (!Array.isArray(this.signatureProviders.metaFunctions[sigName])) {
							this.signatureProviders.metaFunctions[sigName] = [ this.signatureProviders.metaFunctions[sigName] ];
						}
						this.signatureProviders.metaFunctions[sigName].push(item_def);
					} else {
						this.signatureProviders.metaFunctions[sigName] = item_def;
					}
				}
				break;
		}
	}
}

module.exports = SignatureProvider;