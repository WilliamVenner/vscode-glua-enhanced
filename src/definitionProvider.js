const vscode = require("vscode");
const https = require("follow-redirects").https;
const fs = require("fs");

const TempFile = require("./tempFile");
const { TokenAnalyzer } = require("./gluaparse");
const WikiProvider = require("./wikiProvider");

class DefinitionProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.DefinitionProvider = this;

		this.docs = this.GLua.WikiProvider.docs;
		this.GLuaParser = this.GLua.GLuaParser;

		this.definitions = {
			metaFunctions: {},
			libraries: {},
			globalFunctions: {}
		};

		this.registerSubscriptions();
	}

	registerSubscriptions() {
		this.GLua.extension.subscriptions.push(vscode.languages.registerDefinitionProvider("glua", this));
	}

	provideGitHubDefinition(src, originSelectionRange) {
		let url = WikiProvider.getSrcGitHubURL(src, true);
		return new Promise((resolve, reject) => {
			if (!url) { reject(); return; }

			let srcTmpFileName = "Facepunch/garrysmod/" + src[0];
			let srcTmpFilePath = TempFile.getTempPath(srcTmpFileName);

			new Promise((resolve, reject) => {

				if (fs.existsSync(srcTmpFilePath)) {
					let stat = fs.statSync(srcTmpFilePath);
					if (stat.size > 0 && (((new Date()) - stat.mtime) / 1000) < 86400) {
						resolve();
						return;
					}
				}

				this.GLua.openTempFile(srcTmpFileName).then(([_, fd, close, dispose]) => {
					vscode.window.withProgress({
						cancellable: true,
						location: vscode.ProgressLocation.Notification,
						title: "Downloading source from GitHub...",
					}, (progress, cancel) => new Promise((resolve, reject) => {
						progress.report({ increment: 0, message: "0%" });

						let req = https.get(url, (stream) => {
							let maxLength = "content-length" in stream.headers ? Number(stream.headers["content-length"]) : false;
							if (typeof maxLength === "number" && maxLength > 0) {
								let receivedBytes = 0;
								stream.on("data", chunk => {
									receivedBytes += chunk.length;
									progress.report({ increment: (chunk.length / maxLength) * 100, message: Math.round(receivedBytes / maxLength) + "%" })
								});
							}

							stream.on("end", () => {
								progress.report({ increment: 100, message: "100%" });
								resolve(cancel);
							});
							stream.on("error", (err) => {
								vscode.window.showErrorMessage("Error: " + err);
								dispose(); reject()
							});

							stream.pipe(fs.createWriteStream(srcTmpFilePath, { fd, encoding: "utf-8" }));
						})
						
						cancel.onCancellationRequested(() => { req.destroy(); reject(); })
					})).then(resolve, reject);
				}, reject);

			}).then((cancel) => {

				if (cancel && cancel.isCancellationRequested) {
					reject();
					return;
				}

				let srcLines = src[1].split("-");
				let pos = srcLines.length === 1 ? new vscode.Position(srcLines[0]-1, 0) : new vscode.Range(srcLines[0]-1, 0, srcLines[1]-1, Number.MAX_SAFE_INTEGER);
				resolve({ originSelectionRange, targetUri: vscode.Uri.file(srcTmpFilePath), targetRange: pos });

			}, reject);
		});
	}

	provideDefinition(textDocument, pos, cancel) {
		if (cancel.isCancellationRequested) return;

		let word = textDocument.getWordRangeAtPosition(pos); if (!word || word === "." || word === ":" || word === "self") return;
		word = textDocument.getText(word);

		return new Promise(resolve => {

			let definitions = [];
			let promises = [];

			let token = this.GLuaParser.getTokenAt(textDocument, pos); if (token) {
			switch(token.type) {
				case "MemberExpression":
				case "Identifier":
					var [func_call, range, base] = TokenAnalyzer.qualifyMemberExpression(token, pos, true);
					// No, it's VSCode that ignores the range returned here if multiple definitions are provided, it's not a bug on our end
					
					let isLocal = false;
					while ("base" in base) {
						if ("isLocal" in base && base.isLocal) {
							isLocal = true;
							break;
						}
						if ("base" in base.base) base = base.base;
						else break;
					}
					
					promises.push(this.getDefinitions(func_call, token, isLocal ? pos.line : undefined, range));
					break;

				case "StringLiteral":
				case "BinaryExpression":
					if (!("parent" in token)) return;
					var func_call = TokenAnalyzer.getFullFunctionCall(token.parent);
					if (func_call && func_call.length === 3) {
						let full_func_call = func_call.join("");
						switch(full_func_call) {
							case "net.Receive":
							case "net.Start":
							case "util.AddNetworkString":
								let networkStrings = this.GLua.GLuaParser.TokenIntellisenseProvider.compiledTokenData.definitions.networkStrings;
								if (token.value in networkStrings) {
									this.pushDefinitions(definitions, promises, networkStrings[token.value], new vscode.Range(token.loc.start.line-1, token.loc.start.column, token.loc.end.line-1, token.loc.end.column), undefined, token.parent.uri);
								}
								break;
		
							case "hook.Run":
							case "hook.Add":
							case "hook.Call":
							case "hook.Remove":
								// TODO
								break;
						}
					}
					break;
			}}

			if (promises.length == 0) {
				resolve(definitions.length > 0 ? definitions : undefined);
			} else {
				Promise.all(promises).then((promisedDefinitions) => {
					if (promisedDefinitions) {
						resolve(definitions.concat(...promisedDefinitions).filter(v => !!v));
					} else resolve(definitions.length > 0 ? definitions : undefined);
				}, (err) => {
					if (err) console.error(err);
					resolve(definitions.length > 0 ? definitions : undefined);
				});
			}
			
		});
	}

	pushDefinitions(definitions, promises, push, originSelectionRange, line, uri) {
		let isArray = Array.isArray(push);
		let i = 0;
		while (!isArray || i < push.length) {
			let push_me = isArray ? push[i] : push;

			if ("loc" in push_me && line != undefined && push_me.loc.start.line > line) {
				if (isArray) { i++; continue; }
				else break;
			}
			if ("SRC" in push_me) {
				promises.push(this.provideGitHubDefinition(push_me.SRC, originSelectionRange));
			} else {
				definitions.push({ originSelectionRange, targetUri: push_me.uri || uri, targetRange: new vscode.Range(push_me.loc.start.line-1, push_me.loc.start.column, push_me.loc.end.line-1, push_me.loc.end.column) });
			}

			if (!isArray) break;
			else i++;
		}
	}

	getDefinitions(func_call, token, line, originSelectionRange) {
		return new Promise(resolve => {
			if (func_call.length === 0) { resolve(); return; }

			let full_call = func_call.join("");

			let definitions = [];
			let promises = [];

			if (token && func_call.length === 1) {
				// Check for scoped types
				let parent = token;
				while (parent) {
					if ("scope" in parent && full_call in parent.scope) {
						this.pushDefinitions(definitions, promises, parent.scope[full_call], originSelectionRange, line, vscode.window.activeTextEditor.document.uri);
						break;
					}

					if ("parent" in parent) parent = parent.parent;
					else break;
				}
			}

			if ((func_call.length < 3 || func_call[func_call.length-2] !== ":") && full_call in this.GLua.GLuaParser.TokenIntellisenseProvider.compiledTokenData.globals) {
				this.pushDefinitions(definitions, promises, this.GLua.GLuaParser.TokenIntellisenseProvider.compiledTokenData.globals[full_call], originSelectionRange, line, vscode.window.activeTextEditor.document.uri);
			}

			let definitionsProvider = this.GLua.GLuaParser.TokenIntellisenseProvider.compiledTokenData.definitions;
			if (func_call.length === 1) {

				let global_func_name = func_call[0];
				if (global_func_name in definitionsProvider.globalFunctions) {
					this.pushDefinitions(definitions, promises, definitionsProvider.globalFunctions[global_func_name], originSelectionRange);
				}

				var tag = "GLOBAL:" + func_call[0];
				if (tag in this.docs && "SRC" in this.docs[tag]) {
					this.pushDefinitions(definitions, promises, this.docs[tag], originSelectionRange);
				}

			} else if (func_call.length >= 3) {
				// First check for the user's definitions in the workspace and stuff
				let meta_func_name = func_call[func_call.length-1];
				if (meta_func_name in definitionsProvider.metaFunctions) {
					this.pushDefinitions(definitions, promises, definitionsProvider.metaFunctions[meta_func_name], originSelectionRange);
				}
				
				let library_func_name = full_call.replace(":", ".");
				if (library_func_name in definitionsProvider.libraries) {
					this.pushDefinitions(definitions, promises, definitionsProvider.libraries[library_func_name], originSelectionRange);
				}

				// Next we'll check in the documentation data
				var tag = "FUNCTION:" + full_call;
				if (tag in this.docs && "SRC" in this.docs[tag]) {
					this.pushDefinitions(definitions, promises, this.docs[tag], originSelectionRange);
				}

				var tag = "META_FUNCTION:" + full_call;
				if (tag in this.docs && "SRC" in this.docs[tag]) {
					this.pushDefinitions(definitions, promises, this.docs[tag], originSelectionRange);
				}
			}

			if (promises.length > 0) {
				Promise.all(promises).then((promiseDefinitions) => {
					definitions = definitions.concat(promiseDefinitions).filter(v => !!v);
					resolve(definitions.length > 0 ? definitions : undefined);
				}, (err) => {
					if (err) console.error(err);
					resolve(definitions.length > 0 ? definitions : undefined);
				});
			} else {
				resolve(definitions.length > 0 ? definitions : undefined);
			}
		});
	}

	registerDefinition(type, name, token) {
		if (!(name in this.definitions[type])) this.definitions[type][name] = [];
		this.definitions[type][name].push(token);
	}
}

module.exports = DefinitionProvider;