const path = require("path");
const vscode = require("vscode");

const fs = require("fs");
const READFILE_OPTIONS = { encoding: "utf-8" };

const { SCOPE_CONTROLLERS } = require("./constants");
const { CompletionProvider, REGEXP_FUNC_COMPLETIONS } = require("./completionProvider");
const TempFile = require("./tempFile");

const gluaparse = require("gluaparse");
const GLUAPARSE_OPTIONS = {
	comments: false,
	scope: true,
	ranges: true,
	locations: true,
	luaVersion: "5.1",
};

/* class ENUM_TOKEN_TYPE {
	static LocalStatement = 0;
	static AssignmentStatement = 1;
	static UnaryExpression = 2;
	static BinaryExpression = 3;
	static LogicalExpression = 4;
	static FunctionDeclaration = 5;
	static ForGenericStatement = 6;
	static IfClause = 7;
	static ElseifClause = 8;
	static WhileStatement = 9;
	static RepeatStatement = 10;
	static Chunk = 11;
	static ElseClause = 12;
	static DoStatement = 13;
	static ForNumericStatement = 14;
	static ReturnStatement = 15;
	static IfStatement = 16;
	static MemberExpression = 17;
	static IndexExpression = 18;
	static LabelStatement = 19;
	static CallStatement = 20;
	static GotoStatement = 21;
	static TableConstructorExpression = 22;
	static TableKey = 23;
	static TableKeyString = 24;
	static TableValue = 25;
	static CallExpression = 26;
	static TableCallExpression = 27;
	static StringCallExpression = 28;
	static Identifier = 29;
	static NumericLiteral = 30;
	static BooleanLiteral = 31;
	static StringLiteral = 32;
	static NilLiteral = 33;
	static VarargLiteral = 34;
	static BreakStatement = 35;
	static Comment = 36;
}
const TOKEN_TYPE = (str) => ENUM_TOKEN_TYPE[str]; */

// https://github.com/fstirlitz/luaparse/blob/3f760830a908ee6ab01c7fc28f25b2aba137d695/test/runner.js#L179
const TOKEN_LIST_FIELDS = {
	AssignmentStatement : [ "variables", "init" ],
	BinaryExpression : [ "left", "right" ],
	CallExpression : [ "base", "arguments" ],
	CallStatement : [ "expression" ],
	DoStatement : [ "body" ],
	ElseClause : [ "body" ],
	ElseifClause : [ "condition", "body" ],
	ForGenericStatement : [ "variables", "iterators", "body" ],
	ForNumericStatement : [ "variable", "start", "end", "body", "step" ],
	FunctionDeclaration : [ "parameters", "body" ],
	GotoStatement : [ "label" ],
	IfClause : [ "condition", "body" ],
	IfStatement : [ "clauses" ],
	IndexExpression : [ "base", "index" ],
	LabelStatement : [ "label" ],
	LocalStatement : [ "variables", "init" ],
	LogicalExpression : [ "left", "right" ],
	MemberExpression : [ "base" ],
	ReturnStatement : [ "arguments" ],
	StringCallExpression : [ "base", "argument" ],
	TableConstructorExpression : [ "fields" ],
	TableKey : [ "key", "value" ],
	TableKeyString : [ "key", "value" ],
	TableValue : [ "value" ],
	UnaryExpression : [ "argument" ],
	WhileStatement : [ "condition", "body" ],
	RepeatStatement: [ "condition", "body" ],

	Chunk: [ "body" ],
};

const FUNC_ARGUMENT_TREE_TOKENS = {
	"CallStatement": true,
	"CallExpression": true,
	"IndexExpression": true,
	"MemberExpression": true
};

const NETWORK_VAR_TYPES = {
	"Int": "number",
	"Bool": "boolean",
	"Float": "number",
	"String": "string",
};

/*
// .+?:\{\}\n -> 
// (.+?):\{(.+?)\} -> $1 : [ $2 ],
// (\S+?): true -> "$1"
// https://github.com/fstirlitz/luaparse/blob/master/test/runner.js#L179
var scanned = {};
function scan_types(token) {
	if ("type" in token) {
		if (!(token.type in scanned)) {
			scanned[token.type] = {};
		}
	}
	for (let [key, val] of Object.entries(token)) {
		if (val === null || typeof val !== "object" || key === "range" || key == "loc" || key === "identifier") continue;
		if ("type" in token && typeof key === "string") {
			scanned[token.type][key] = true;
		}
		scan_types(val);
	}
}
*/

class TokenAnalyzer {
	static getTokenStart(token) {
		if (!("_vscodeStart" in token)) token._vscodeStart = new vscode.Position(token.loc.start.line-1, token.loc.start.column);
		return token._vscodeStart;
	}

	static getTokenEnd(token) {
		if (!("_vscodeEnd" in token)) token._vscodeEnd = new vscode.Position(token.loc.end.line-1, token.loc.end.column);
		return token._vscodeEnd;
	}

	static getTokenRange(token) {
		if (!("_vscodeRange" in token)) token._vscodeRange = new vscode.Range(token.loc.start.line-1, token.loc.start.column, token.loc.end.line-1, token.loc.end.column);
		return token._vscodeRange;
	}

	// https://i.venner.io/Code_Rgn30adjJU.png
	static getFullFunctionCallDiscover(token, func_call, callback, callback_data) {
		if (callback && callback(token, callback_data) === false) return false;
		if ("expression" in token) {
			return TokenAnalyzer.getFullFunctionCallDiscover(token.expression.base, func_call, callback, callback_data);
		} else {
			if ("identifier" in token && token.identifier) {
				if (callback && callback(token.identifier, callback_data) === false) return false;
				func_call.push(token.identifier.name);
				if (token.indexer) func_call.push(token.indexer);
			} else if ("name" in token && token.name) {
				func_call.push(token.name);
				if (token.indexer) func_call.push(token.indexer);
			}
			
			if ("base" in token && TokenAnalyzer.getFullFunctionCallDiscover(token.base, func_call, callback, callback_data) === false) return false;

			return func_call;
		}
	}

	static getFullFunctionCall(token, callback) {
		let callback_data = callback && [];
		let full_call = TokenAnalyzer.getFullFunctionCallDiscover(token, [], callback, callback_data);
		return callback ? [full_call ? full_call.reverse() : full_call, callback_data] : full_call.reverse();
	}

	static getFunctionArguments(token) {
		var token = token;
		while (token) {
			if ("arguments" in token) {
				return token.arguments;
			} else if (token.type === "CallStatement" || token.type === "CallExpression") {
				if ("expression" in token && "arguments" in token.expression) {
					return token.expression.arguments;
				}
			}
			
			if ("parent" in token && token.parent.type in FUNC_ARGUMENT_TREE_TOKENS) token = token.parent;
			else break;
		}
	}

	static parseStringLiteral(token) {
		if (token.type === "StringLiteral") {
			return token.value;
		} else if (token.type === "BinaryExpression" && token.operator === "..") {
			let left = TokenAnalyzer.parseStringLiteral(token.left);
			if (!left) return;
			let right = TokenAnalyzer.parseStringLiteral(token.right);
			if (!right) return;
			return left + right;
		} 
	}

	static qualifyMemberExpression(token, pos, returnRange) {
		let func_call = [];
		
		let root = token;
		while ("base" in root) root = root.base;

		let parent = root;
		while (parent) {
			if (parent.type !== "MemberExpression" && parent.type !== "Identifier" && parent.type !== "CallExpression") break;

			let identifier = "identifier" in parent ? parent.identifier : parent;
			if ("indexer" in parent) func_call.push(parent.indexer);
			if (parent.type === "CallExpression") {
				func_call[func_call.length-1] += "()";
			} else {
				func_call.push(identifier.name);
			}
		
			if (pos && TokenAnalyzer.getTokenRange(identifier).contains(pos)) break;
			if ("parent" in parent)	parent = parent.parent;
			else break;
		}

		if (returnRange) return [func_call, TokenAnalyzer.getTokenRange(parent), parent];
		return func_call;
	}
}

class TokenExtractor {
	constructor(parsed, GLua, uri) {
		if (GLua && uri) {
			this.GLua = GLua;
			this.uri = uri;
			this.GLua.TokenIntellisenseProvider.createTokenData(this.uri);
		}
		
		this.extracts = { RAW: parsed, TYPES: {}, LIST: [], LINES: { MAX: 0, LIST: [] } };

		this.visited = new Map();
		this.traverseTree(parsed);
		delete this.visited;
		delete this.parsed;
	}

	static structurizeLineLocation(index, extracts, line) {
		if (!(line in extracts.LINES.LIST) || index < extracts.LINES.LIST[line]) {
			extracts.LINES.MAX = Math.max(line, extracts.LINES.MAX);
			if (extracts.LINES.MIN == undefined) extracts.LINES.MIN = line;
			extracts.LINES.LIST[line] = index;
		}
	}

	parseGlobalTable(base, token) {
		if (token.type !== "TableConstructorExpression") return;
		// console.log(token);
		// TODO
	}

	parseToken(token, parent) {
		// token.enum_type = TOKEN_TYPE(token.type);
		
		if (parent) token.parent = parent;

		if (!(token.type in this.extracts.TYPES)) this.extracts.TYPES[token.type] = { LIST: [], LINES: { MAX: 0, LIST: [] } };
		let typesObj = this.extracts.TYPES[token.type];
		
		// We can optimize token searching by creating pointers to the first token found after a specified line
		var listIndex = this.extracts.LIST.push(token);
		var typesListIndex = typesObj.LIST.push(token);
		if ("loc" in token && token.type !== "Chunk") {
			TokenExtractor.structurizeLineLocation(listIndex-1, this.extracts, token.loc.start.line-1);
			TokenExtractor.structurizeLineLocation(typesListIndex-1, typesObj, token.loc.start.line-1);
		}

		if (this.GLua) {
			token.uri = this.uri;

			switch(token.type) {
				case "ForGenericStatement":
					for (let i = 0; i < token.variables.length; i++) {
						if (!token.scope) token.scope = {};
						token.scope[token.variables[i].name] = token.variables[i];
					}
					break;

				case "ForNumericStatement":
					if (!token.scope) token.scope = {};
					token.scope[token.variable.name] = token.variable;
					break;

				case "FunctionDeclaration":
					if (token.identifier !== null) {
						this.traverseTree(token.identifier, token);
						let full_func_name = TokenAnalyzer.qualifyMemberExpression(token.identifier);
						if (full_func_name.length > 0) {
							let func_name = full_func_name.join("");

							let isLocal = token.isLocal;
							if (!isLocal && token.identifier && token.identifier.type === "MemberExpression") {
								let identifier = token.identifier;
								while (identifier) {
									if (identifier.isLocal) {
										isLocal = true;
										break;
									}
									
									if ("base" in identifier) identifier = identifier.base;
									else break; 
								}
							}

							if (!isLocal && full_func_name.length === 1 && "parent" in token) {
								let parent = token.parent;
								while (parent) {
									if ("scope" in parent && func_name in parent.scope) {
										isLocal = true;
										break;
									}

									if ("parent" in parent) parent = parent.parent;
									else break;
								}
							}
							
							if (isLocal) {
								if (!("scope" in token)) token.scope = {};
								token.scope[func_name] = token;
								if ("parent" in token) {
									let parent = token.parent;
									while (parent) {
										if (parent.type in SCOPE_CONTROLLERS) {
											if (!("scope" in parent)) parent.scope = {};
											parent.scope[func_name] = token;
											break;
										}
										if ("parent" in parent) parent = parent.parent;
										break;
									}
								}
							} else {//if (full_func_name.length < 3 || full_func_name[full_func_name.length-2] !== ":") {
								this.GLua.TokenIntellisenseProvider.addGlobal(token, full_func_name, func_name, true);

							/*} else if (full_func_name[0] === "PANEL" || is panel via vgui.Register?) {
								// PANEL:Function()
							} else if (full_func_name[0] in global table names for entity/effect etc) {
								// ENT:Function()
							} else {
								// Meta function
							*/}
						}
					}

					for (let i = 0; i < token.parameters.length; i++) {
						let param = token.parameters[i];
						let name = param.name;
						if (name === "self") continue;
						if (!("scope" in token)) token.scope = {};
						token.scope[name] = param;
					}
					break;

				case "AssignmentStatement":
					if (token.isLocal) break;
					for (let i = 0; i < token.variables.length; i++) {
						if (!(i in token.init) || token.init[i].type === "NilLiteral" || token.variables[i].isLocal) continue;
						this.traverseTree(token.init[i], token);
						this.traverseTree(token.variables[i], token);

						let full_name = TokenAnalyzer.qualifyMemberExpression(token.variables[i]);
						if (full_name[0] === "self") continue;
						let name = full_name.join("");

						let isLocal = false;

						let base = token.variables[i];
						while (base) {
							if (base.isLocal) {
								isLocal = true;
								break;
							}
							if ("base" in base) base = base.base;
							else break;
						} if (isLocal) continue;

						let parent = token;
						while (parent) {
							if ("scope" in parent && name in parent.scope) {
								isLocal = true;
								break;
							}
							if ("parent" in parent) parent = parent.parent;
							else break;
						} if (isLocal) continue;

						token.uri = this.uri;

						this.GLua.TokenIntellisenseProvider.addGlobal(token, full_name, name, false);
						
						this.parseGlobalTable(name, token.init[i]);
					}
					break;

				case "LocalStatement":
					let parent = token;
					while (parent) {
						if (parent.type in SCOPE_CONTROLLERS) {
							for (let i = 0; i < token.variables.length; i++) {
								if (!token.variables[i].isLocal) continue;
								if (!parent.scope) parent.scope = {};
								parent.scope[token.variables[i].name] = token.variables[i];
							}
							break;
						}
						if ("parent" in parent) parent = parent.parent;
						else break;
					}
					break;

				case "CallExpression":
					if ("base" in token && token.base.isLocal) break;

					const docs = this.GLua.WikiProvider.docs;

					const split = TokenAnalyzer.getFullFunctionCall(token);
					if (split.length === 0) break;
					if (split.length === 1) {
						var tag = "GLOBAL:" + split[0];
						if (tag in docs) {
							if (!("DOC" in token)) token.DOC = [];
							token.DOC.push(docs[tag]);
						}
					} else {
						const full_call = split.join("");
						if (split.length < 3 || split[split.length-2] !== ":") {
							var tag = "FUNCTION:" + full_call;
							if (tag in docs) {
								if (!("DOC" in token)) token.DOC = [];
								token.DOC.push(docs[tag]);
							}
						} else {
							let meta_func = split[split.length-1];
							if (meta_func in this.GLua.SignatureProvider.signatures.metaFunctions) {
								if (!("DOC" in token)) token.DOC = [];
								if (Array.isArray(this.GLua.SignatureProvider.signatures.metaFunctions[meta_func])) {
									token.DOC = token.DOC.concat(this.GLua.SignatureProvider.signatures.metaFunctions[meta_func]);
								} else {
									token.DOC.push(this.GLua.SignatureProvider.signatures.metaFunctions[meta_func]);
								}
								// TODO infer types and improve accuracy
							}
						}

						if (this.uri && (!("parent" in token) || token.parent.type !== "AssignmentStatement")) {
							let tokenArguments = TokenAnalyzer.getFunctionArguments(token);
							if (!tokenArguments) break;
							switch(full_call) {
								case "debug.setfenv":
								case "setfenv":
								case "module":
									// TODO
									break;

								case "util.AddNetworkString":
									if (tokenArguments.length >= 1) {
										let networkString = TokenAnalyzer.parseStringLiteral(tokenArguments[0]);
										if (networkString) this.GLua.TokenIntellisenseProvider.addNetworkString(undefined, networkString, this.uri);
									}
									break;

								case "net.Receive":
									if (tokenArguments.length >= 1) {
										let networkString = TokenAnalyzer.parseStringLiteral(tokenArguments[0]);
										if (networkString) this.GLua.TokenIntellisenseProvider.addNetworkString(token, networkString, this.uri);
									}
									break;

								case "net.Start":
									if (tokenArguments.length >= 1) {
										let networkString = TokenAnalyzer.parseStringLiteral(tokenArguments[0]);
										if (networkString) this.GLua.TokenIntellisenseProvider.addNetworkString(token, networkString, this.uri, true);
									}
									break;
								
								default:
									if (split[split.length-2] === ":") {
										if (split[split.length-1] === "NetworkVar") {
											if (tokenArguments.length >= 3) {
												let varType = TokenAnalyzer.parseStringLiteral(tokenArguments[0]);
												let varName = TokenAnalyzer.parseStringLiteral(tokenArguments[2]);
												if (varType && varName) {
													varType = varType in NETWORK_VAR_TYPES ? NETWORK_VAR_TYPES[varType] : varType;
													this.GLua.TokenIntellisenseProvider.addNetworkVar(token, varType, varName);
												}
											}
										}
									}
							}
						}
					}

					break;
			}
		}
	}

	traverseTree(token, parent) {
		if (this.visited.has(token)) return;
		this.visited.set(token, true);

		this.parseToken(token, parent);
		
		if (token.type in TOKEN_LIST_FIELDS) {
			for (let i = 0; i < TOKEN_LIST_FIELDS[token.type].length; i++) {
				let field = TOKEN_LIST_FIELDS[token.type][i];
				if (!(field in token)) continue;

				switch(field) {
					case "value":
						if (token.value !== null && typeof token.value === "object") {
							this.traverseTree(token.value, token);
						}
						break;
					
					default:
						if (token[field] !== null) {
							if (Array.isArray(token[field]))
								for (let j = 0; j < token[field].length; j++) this.traverseTree(token[field][j], token);
							else
								this.traverseTree(token[field], token);
						}
				}
			}
		}
	}
}

class GLuaParser {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.GLuaParser = this;

		this.parsedFiles = {};
		this.visibleTextEditors = new Map();
		this.scanChangesTimeouts = new Map();

		this.registerEvents(this);

		this.TokenIntellisenseProvider = new TokenIntellisenseProvider(GLua);
	}

	static isParseableTextDocument(textDocument) {
		return (textDocument.uri.scheme === "file" || textDocument.isUntitled) && textDocument.languageId === "glua" && !textDocument.isClosed && textDocument.lineCount > 0;
	}

	static isTempGitHubDownload(uri) {
		if (uri.scheme !== "file") return false;
		let tmpPath = TempFile.getTempPath("Facepunch/garrysmod");
		let relPath = path.relative(uri.fsPath, tmpPath);
		return relPath != tmpPath;
	}

	parse(str, uri) {
		let parsed;
		try {
			parsed = gluaparse.parse(str, GLUAPARSE_OPTIONS);
		} catch(err) {
			// TODO show errors?
			return;
		}

		return (new TokenExtractor(parsed, this.GLua, uri)).extracts;
	}

	registerEvents(GLuaParser) {
		this.onFileParsedListeners = [];
		this.onActiveTextEditorParsedListeners = [];

		vscode.window.onDidChangeActiveTextEditor((textEditor) => GLuaParser.onDidChangeActiveTextEditor(textEditor));
		vscode.window.onDidChangeVisibleTextEditors((textEditors) => GLuaParser.onDidChangeVisibleTextEditors(textEditors));
		vscode.workspace.onDidChangeTextDocument((e) => GLuaParser.scanChanges(e));
	}

	onDidChangeActiveTextEditor(textEditor) {
		if (textEditor && !(textEditor.document.uri.fsPath in this.parsedFiles) && GLuaParser.isParseableTextDocument(textEditor.document)) {
			this.parseText(textEditor.document.uri, textEditor.document.getText());
		}
	}

	onDidChangeVisibleTextEditors(textEditors) {
		let visible = new Map();

		for (let i = 0; i < textEditors.length; i++) {
			let textEditor = textEditors[i];
			if (textEditor.document.uri.scheme !== "file") continue;

			let path = textEditor.document.uri;
			if (GLuaParser.isParseableTextDocument(textEditor.document)) {
				visible.set(textEditor, true);
				this.parseText(path, textEditor.document.getText());
			} else if (path.fsPath in this.parsedFiles) {
				delete this.parsedFiles[path.fsPath];
			}
		}

		this.visibleTextEditors.forEach((_, textEditor) => {
			if (!visible.has(textEditor) && textEditor.document.uri.fsPath in this.parsedFiles) {
				delete this.parsedFiles[textEditor.document.uri.fsPath];
			}
		})

		this.visibleTextEditors = visible;
	}

	onFileParsed(func) {
		this.onFileParsedListeners.push(func);
	}

	onActiveTextEditorParsed(func)  {
		this.onActiveTextEditorParsedListeners.push(func);
	}

	onFileParsedEvent(fsPath) {
		if (this.parsingWorkspace) return;

		if (!(fsPath in this.parsedFiles)) return;
		let eventReturn = this.parsedFiles[fsPath];

		for (let i = 0; i < this.onFileParsedListeners.length; i++) this.onFileParsedListeners[i](fsPath, eventReturn);

		if (vscode.window.activeTextEditor && GLuaParser.isParseableTextDocument(vscode.window.activeTextEditor.document) && fsPath == vscode.window.activeTextEditor.document.uri.fsPath) {
			for (let i = 0; i < this.onActiveTextEditorParsedListeners.length; i++) this.onActiveTextEditorParsedListeners[i](fsPath, eventReturn);
		}
	}

	scanChanges(e) {
		if (GLuaParser.isParseableTextDocument(e.document)) {

			if (this.scanChangesTimeouts.has(e.document)) clearTimeout(this.scanChangesTimeouts.get(e.document));

			this.scanChangesTimeouts.set(e.document, setTimeout((textDocument) => {
				if (!GLuaParser.isParseableTextDocument(textDocument)) return;
				this.parseText(textDocument.uri, textDocument.getText());
			}, 1000, e.document));

		} else if (e.document.uri.fsPath in this.parsedFiles) {
			delete this.parsedFiles[path.fsPath];
		}
	}

	parseWorkspace() {
		this.parsingWorkspace = true;

		return new Promise((resolve) => {
			let parsedFiles = {};

			Promise.all([
				new Promise((resolve) => {
					let parsePromises = [];
					for (let i = 0; i < vscode.workspace.textDocuments.length; i++) {
						let textDocument = vscode.workspace.textDocuments[i];
						if (textDocument.uri.scheme !== "file") continue;

						let path = textDocument.uri;
						if (path.fsPath in parsedFiles) continue;
						if (GLuaParser.isParseableTextDocument(textDocument)) {
							parsePromises.push(this.parseText(path, textDocument.getText()));
						} else if (path.fsPath in this.parsedFiles) {
							delete this.parsedFiles[path.fsPath];
						}
					}
					Promise.all(parsePromises).then(resolve);
				}),

				new Promise((resolve) => {
					vscode.workspace.findFiles("**/*.lua").then(results => {
						let parsePromises = [];
						for (let i = 0; i < results.length; i++) {
							let path = results[i];
							if (path.fsPath in parsedFiles) continue;
							parsePromises.push(this.parseFile(path, parsedFiles));
						}
						Promise.all(parsePromises).then(resolve);
					});
				}),
			]).then(() => {
				delete this.parsingWorkspace;
				this.parsedFiles = parsedFiles;
				resolve(parsedFiles);
			});
		});
	}

	parseFile(path, parsedFiles) {
		var parsedFiles = parsedFiles || this.parsedFiles;

		return new Promise((resolve) => {
			fs.readFile(path.fsPath, READFILE_OPTIONS, (err, data) => {
				if (err) {
					console.warn("vscode-glua failed to gluaparse " + path.fsPath);
					console.warn("vscode-glua \"" + err + "\"");

					if (parsedFiles[path.fsPath]) delete parsedFiles[path.fsPath];
					this.onFileParsedEvent(path.fsPath);

					resolve();
				} else {
					parsedFiles[path.fsPath] = this.parse(data, path);
					this.onFileParsedEvent(path.fsPath);

					resolve(parsedFiles[path.fsPath]);
				}
			});
		});
	}

	parseFileSync(path, parsedFiles) {
		let fsPath = path.fsPath;
		var parsedFiles = parsedFiles || this.parsedFiles;

		let data;
		try {
			data = fs.readFileSync(fsPath, READFILE_OPTIONS);
		} catch(err) {
			console.warn("vscode-glua failed to gluaparse " + fsPath);
			console.warn("vscode-glua \"" + err + "\"");

			if (parsedFiles[fsPath]) delete parsedFiles[fsPath];
			this.onFileParsedEvent(fsPath);

			return;
		}

		parsedFiles[fsPath] = this.parse(data, path);
		this.onFileParsedEvent(fsPath);

		return parsedFiles[fsPath];
	}

	parseText(path, data) {
		let parsed = this.parse(data, path);
		if (parsed) {
			this.parsedFiles[path.fsPath] = parsed;
			this.onFileParsedEvent(path.fsPath);
		}
		return this.parsedFiles[path.fsPath];
	}

	getParsed(path, document) {
		if (path.fsPath in this.parsedFiles) {
			return this.parsedFiles[path.fsPath];
		} else {
			return this.parseText(path, document.getText());
		}
	}

	findChunkAt(document, pos) {
		if (!GLuaParser.isParseableTextDocument(document)) {
			console.warn("vscode-glua tried to get tokens at position for a non-GLua file??");
			return;
		}

		let parsed = this.getParsed(document.uri, document);
		if (parsed) {
			let tokenRefs = parsed.LIST;
			let tokenSearch = parsed.LINES;

			if (!("MIN" in tokenSearch)) return;
			
			let tokenSearchStart = pos.line;
			while (!tokenSearch.LIST[tokenSearchStart]) {
				tokenSearchStart--;
				if (tokenSearchStart <= tokenSearch.MIN) {
					tokenSearchStart = tokenSearch.MIN;
					break;
				}
			}

			tokenSearchStart = tokenSearch.LIST[tokenSearchStart];

			let token = tokenRefs[tokenSearchStart];
			while (token) {
				if (token.type in SCOPE_CONTROLLERS && (new vscode.Range(token.loc.start.line-1, token.loc.start.column, token.loc.end.line-1, token.loc.end.column)).contains(pos)) return token;
				if ("parent" in token) token = token.parent;
				else break;
			}
		}
	}

	static getNestedTokens(token, map) {
		var map = map ? map : new Map();
		if (token.type in TOKEN_LIST_FIELDS && !(token.type in SCOPE_CONTROLLERS)) {
			for (let i = 0; i < TOKEN_LIST_FIELDS[token.type].length; i++) {
				let field = TOKEN_LIST_FIELDS[token.type][i];
				if (!(field in token)) continue;

				switch(field) {
					case "value":
						if (token.value !== null && typeof token.value === "object") {
							map.set(token.value, true);
							GLuaParser.getNestedTokens(token.value, map);
						}
						break;
					
					default:
						if (token[field] !== null) {
							if (Array.isArray(token[field])) {
								for (let j = 0; j < token[field].length; j++) {
									map.set(token[field][j], true);
									GLuaParser.getNestedTokens(token[field][j], map);
								}
							} else {
								map.set(token[field], true);
								GLuaParser.getNestedTokens(token[field], map);
							}
						}
				}
			}
		}
		return map;
	}

	getTokenAt(document, pos, type) {
		if (!GLuaParser.isParseableTextDocument(document)) {
			console.warn("vscode-glua tried to get token at position for a non-GLua file??");
			return;
		}

		let tokens = this.getTokensOnLine(document, pos, type);
		if (!tokens || tokens.length === 0) return;

		let nested = new Map();
		for (let i = 0; i < tokens.length; i++) GLuaParser.getNestedTokens(tokens[i], nested);
		tokens = tokens.concat(Array.from(nested.keys()));

		let found;
		for (let i = 0; i < tokens.length; i++) {
			let token = tokens[i];
			let range = TokenAnalyzer.getTokenRange(token);
			if (!found) {
				if (range.contains(pos)) found = token;
				continue;
			}
			if (range.contains(pos) && TokenAnalyzer.getTokenRange(found).contains(range)) found = token;
		}

		return found;
	}

	getTokensOnLine(document, pos, type) {
		if (!GLuaParser.isParseableTextDocument(document)) {
			console.warn("vscode-glua tried to get tokens at position for a non-GLua file??");
			return [];
		}

		let parsed = this.getParsed(document.uri, document);
		if (parsed) {

			let tokens = [];

			let tokenRefs = !type ? parsed.LIST : (type in parsed.TYPES ? parsed.TYPES[type].LIST : undefined);
			let tokenSearch = !type ? parsed.LINES : (type in parsed.TYPES ? parsed.TYPES[type].LINES : undefined);
			if (!tokenSearch || !("MIN" in tokenSearch)) return tokens;
			
			let tokenSearchStart = pos.line;
			while (!tokenSearch.LIST[tokenSearchStart]) {
				tokenSearchStart--;
				if (tokenSearchStart <= tokenSearch.MIN) {
					tokenSearchStart = tokenSearch.MIN;
					break;
				}
			}

			tokenSearchStart = tokenSearch.LIST[tokenSearchStart];

			let reachedLine = false;
			for (let i = 0; i < (tokenRefs.length - tokenSearchStart); i++) {
				let token = tokenRefs[tokenSearchStart + i];
				if (token.loc.start.line-1 === pos.line || (!(token.type in SCOPE_CONTROLLERS) && TokenAnalyzer.getTokenRange(token).contains(pos))) {
					reachedLine = true;
					tokens.push(token);
				} else if (reachedLine || token.loc.end.line-1 > pos.line) break;
			}

			return tokens;

		} else {
			return [];
		}
	}
}

// Store compiled token data from the workspace separately from the active file
// Provide workspace's token data completions, signatures, definitions etc in a separate subscription
// Compile all the token data whenever the active file is switched
// Compile just the active file's tokens when it is parsed by GLuaParser
class ParsedFileTokenData {
	constructor(uri) {
		this.uri = uri;
		this.data = {
			globals: {},
			_G: {},
			completions: {
				globals: new vscode.CompletionList(),
				globalFunctions: new vscode.CompletionList(),
				metaFunctions: new vscode.CompletionList(),
				libraries: new vscode.CompletionList(),
				networkStrings: new vscode.CompletionList(),
			},
			signatures: {
				globals: {},
				functions: {},
				metaFunctions: {},
			},
			definitions: {
				hooks: {},
				globals: {},
				globalFunctions: {},
				libraries: {},
				metaFunctions: {},
				networkStrings: {},
			},
			references: {
				hooks: {},
				networkStrings: {},
			},
		};

		this.data.completions.globals.subitems = {};
		this.data.completions.globalFunctions.subitems = {};
	}
}

// TODO references (include hooks + net messages)

const REGEXP_NETWORKVAR_CTX = /([^\s\\\/]+?)(?:(?:\/|\\)[^\s\\\/]+?)?\.lua$/;

class TokenIntellisenseProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.TokenIntellisenseProvider = this;
		this.GLuaParser = this.GLua.GLuaParser;
		
		this.workspaceTokenData = {};
		this._compiledTokenData = [ new ParsedFileTokenData(), new ParsedFileTokenData() ]; // [0] = compiled, [1] = compiled + active file

		this.registerProxies();

		this.registerSubscriptions(this);
		this.registerEvents(this);
	}

	registerProxies() {
		this.compiledTokenData = new Proxy(this._compiledTokenData, {
			get: (obj, prop) => {
				if (this.tokenDataDirty) this.compileTokenData();
				if (this.tokenDataDirty || this.activeTokenDataDirty) this.compileActiveTokenData();
				return obj[1].data[prop]; // Return [1] (compiled + active file)
			}
		});
	}

	registerSubscriptions(TokenIntellisenseProvider) {
		CompletionProvider.registerCompletionProvider(this, this.GLua, this.provideTokenCompletionItems, false, ".", ":", "(");
		CompletionProvider.registerCompletionProvider(this, this.GLua, this.provideGlobalCompletionItems, false);
	}

	registerEvents(TokenIntellisenseProvider) {
		this.GLuaParser.onFileParsed((fsPath, parsed) => TokenIntellisenseProvider.onFileParsed(fsPath, parsed));
	}

	onFileParsed(fsPath) {
		if (!vscode.window.activeTextEditor) { this.tokenDataDirty = true; return }
		if (fsPath !== vscode.window.activeTextEditor.document.uri.fsPath) {
			this.tokenDataDirty = true;
		} else {
			this.activeTokenDataDirty = true;
		}
	}
	
	provideGlobalTableCompletionItems(TokenIntellisenseProvider, func_name, func_call) {
		let globalTableKeys = (func_name + func_call).replace(/:/g, ".").split(".");
		if (globalTableKeys.length > 1) {
			let found = false;
			let items = func_call === ":" ? TokenIntellisenseProvider.compiledTokenData.completions.globalFunctions : TokenIntellisenseProvider.compiledTokenData.completions.globals;
			for (let i = 0; i < globalTableKeys.length; i++) {
				let globalKey = globalTableKeys[i];
				if (globalKey in items.subitems) {
					items = items.subitems[globalKey];
					found = true;
				} else if (i !== globalTableKeys.length-1) {
					found = false; break;
				}
			}
			if (found) return items;
		}
	}

	provideGlobalCompletionItems(TokenIntellisenseProvider, document, pos, cancel, ctx, term) {
		let func_match = term.match(REGEXP_FUNC_COMPLETIONS);
		if (func_match && !func_match[3] && !func_match[4]) {
			return TokenIntellisenseProvider.compiledTokenData.completions.globals;
		}
	}

	provideTokenCompletionItems(TokenIntellisenseProvider, document, pos, cancel, ctx, term) {
		let func_match = term.match(REGEXP_FUNC_COMPLETIONS);
		if (func_match) {
			let func_ctx = func_match[1];
			let func_name = func_match[2];
			let func_call = func_match[3];

			let items = TokenIntellisenseProvider.provideGlobalTableCompletionItems(TokenIntellisenseProvider, func_name, func_call);
			if (items) return;
		
			// Check for hook definitions first
			if (func_call === ":" || (func_call === "." && func_ctx === "function")) {
				let hook_family = (func_name === "GAMEMODE" ? "GM" : func_name);
				if (hook_family in TokenIntellisenseProvider.GLua.CompletionProvider.completions.hook) {
					return;
				}
			}

			// Meta functions
			if (func_call === ":") {
				return TokenIntellisenseProvider.compiledTokenData.completions.metaFunctions;
			}
		}
	}

	createTokenData(uri) {
		this.workspaceTokenData[uri.fsPath] = new ParsedFileTokenData(uri);
	}

	getTokenData(uri) {
		if (!(uri.fsPath in this.workspaceTokenData)) this.createTokenData(uri);
		return this.workspaceTokenData[uri.fsPath].data;
	}

	static compileTokenData(compiledTokenData, workspaceTokenData, subitems) {
		for (let member in workspaceTokenData) {
			if ("items" in workspaceTokenData[member]) {
				if (!(member in compiledTokenData)) compiledTokenData[member] = new vscode.CompletionList(undefined, workspaceTokenData[member].isIncomplete);
				if (!("dupes" in compiledTokenData[member])) compiledTokenData[member].dupes = {};
				if (subitems && !("subitems" in compiledTokenData[member])) compiledTokenData[member].subitems = {};
				
				for (let i = 0; i < workspaceTokenData[member].items.length; i++) {
					let item = workspaceTokenData[member].items[i];

					if (!(item.kind in compiledTokenData[member].dupes)) compiledTokenData[member].dupes[item.kind] = {};
					if (item.label in compiledTokenData[member].dupes[item.kind]) continue;

					compiledTokenData[member].dupes[item.kind][item.label] = true;
					compiledTokenData[member].items.push(item);
				}

				if ("subitems" in workspaceTokenData[member]) {
					TokenIntellisenseProvider.compileTokenData(compiledTokenData[member].subitems, workspaceTokenData[member].subitems, true);
				}
			} else if (Array.isArray(workspaceTokenData[member])) {
				if (!(member in compiledTokenData)) compiledTokenData[member] = [];
				compiledTokenData[member] = compiledTokenData[member].concat(workspaceTokenData[member]);
			} else if (!("type" in workspaceTokenData[member])) { // Don't traverse through tokens
				TokenIntellisenseProvider.compileTokenData(compiledTokenData[member], workspaceTokenData[member]);
			} else if (!(member in compiledTokenData)) {
				compiledTokenData[member] = workspaceTokenData[member];
			}
		}
	}

	compileTokenData() {
		this.tokenDataDirty = false;
		this.activeTokenData = vscode.window.activeTextEditor ? (GLuaParser.isParseableTextDocument(vscode.window.activeTextEditor.document) ? vscode.window.activeTextEditor.document.uri.fsPath : undefined) : undefined;

		this._compiledTokenData[0] = new ParsedFileTokenData();
		for (let uri in this.workspaceTokenData) {
			if (this.activeTokenData && uri === this.activeTokenData) continue;
			TokenIntellisenseProvider.compileTokenData(this._compiledTokenData[0].data, this.workspaceTokenData[uri].data);
		}
	}

	static compileActiveTokenData(compiledTokenData, workspaceTokenData) {
		for (let member in workspaceTokenData) {
			if ("items" in workspaceTokenData[member]) {
				compiledTokenData.items = [].concat(workspaceTokenData[member].items);
			} else if (Array.isArray(workspaceTokenData[member])) {
				compiledTokenData[member] = [].concat(workspaceTokenData[member]);
			} else if (!("type" in workspaceTokenData[member])) { // Don't traverse through tokens
				TokenIntellisenseProvider.compileTokenData(compiledTokenData[member], workspaceTokenData[member]);
			} else if (!(member in compiledTokenData)) {
				compiledTokenData[member] = {};
				Object.assign(compiledTokenData[member], workspaceTokenData[member]);
			}
		}
	}

	compileActiveTokenData() {
		this.activeTokenDataDirty = false;
		if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath in this.workspaceTokenData) {
			this._compiledTokenData[1] = new ParsedFileTokenData();
			TokenIntellisenseProvider.compileActiveTokenData(this._compiledTokenData[1].data, this._compiledTokenData[0].data);
			TokenIntellisenseProvider.compileActiveTokenData(this._compiledTokenData[1].data, this.workspaceTokenData[vscode.window.activeTextEditor.document.uri.fsPath].data);
		}
	}

	static addUniqueCompletionItem(completionItem, data) {
		if (!("dupes" in data)) data.dupes = {};
		if (!(completionItem.kind in data.dupes)) data.dupes[completionItem.kind] = {};
		if (completionItem.label in data.dupes[completionItem.kind]) return;
		data.dupes[completionItem.kind][completionItem.label] = true;
		data.items.push(completionItem);
		return true;
	}

	addGlobal(token, func_call, name, is_func) {
		if (GLuaParser.isTempGitHubDownload(token.uri)) return;
		if (func_call[0] in this.GLua.CompletionProvider.completions.struct) return;

		let workspaceTokenData = this.getTokenData(token.uri);

		var completionItem = new vscode.CompletionItem(func_call[0], is_func ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Variable);
		completionItem.detail = "(global)";
		completionItem.DOC_TAG = false;
		
		if (!is_func || func_call.length === 1) {
			TokenIntellisenseProvider.addUniqueCompletionItem(completionItem, workspaceTokenData.completions.globals);
			if (is_func) TokenIntellisenseProvider.addUniqueCompletionItem(completionItem, workspaceTokenData.completions.globalFunctions);
		}
		
		let i = 0;
		while (i === 0 || (is_func && i === 1)) {
			let subitems = i === 0 ? workspaceTokenData.completions.globals : workspaceTokenData.completions.globalFunctions;
			let label = "";
			for (let j = 0; j <= func_call.length; j++) {
				if ((func_call[j] === "." || func_call[j] === ":") || j === func_call.length) {
					let subkey = func_call[j-1];
					if (!(subkey in subitems.subitems)) {
						if (!is_func || j === func_call.length) {
							var completionItem = Object.create(completionItem);
							completionItem.label = label;
							completionItem.insertText = subkey;
							TokenIntellisenseProvider.addUniqueCompletionItem(completionItem, subitems);
						}

						subitems.subitems[subkey] = new vscode.CompletionList(undefined, subitems.isIncomplete);
						subitems.subitems[subkey].subitems = {};
					}
					subitems = subitems.subitems[subkey];
				}
				if (j !== func_call.length) label += func_call[j];
			}
			i++;
		}

		if (is_func) {
			// if (!(name in workspaceTokenData.signatures.functions[name])) workspaceTokenData.signatures.functions[name] = [];
			// workspaceTokenData.signatures.functions[name].push()
			// TODO
		}

		if (func_call.length === 1) {
			if (!(name in workspaceTokenData._G)) workspaceTokenData._G[name] = [];
			workspaceTokenData._G[name].push(token);
		}

		if (!(name in workspaceTokenData.globals)) workspaceTokenData.globals[name] = [];
		workspaceTokenData.globals[name].push(token);
	}

	addNetworkVar(token, varType, varName) {
		if (GLuaParser.isTempGitHubDownload(token.uri)) return;

		let workspaceTokenData = this.getTokenData(token.uri);

		let GetFunc = "Get" + varName; let SetFunc = "Set" + varName;
		if (!(GetFunc in workspaceTokenData.definitions.metaFunctions)) workspaceTokenData.definitions.metaFunctions[GetFunc] = [];
		workspaceTokenData.definitions.metaFunctions[GetFunc].push(token);
		if (!(SetFunc in workspaceTokenData.definitions.metaFunctions)) workspaceTokenData.definitions.metaFunctions[SetFunc] = [];
		workspaceTokenData.definitions.metaFunctions[SetFunc].push(token);

		let ctx = token.uri.fsPath.match(REGEXP_NETWORKVAR_CTX);
		ctx = ctx ? ctx[1] : "Entity";

		var completionItemGet = new vscode.CompletionItem(ctx + ":Get" + varName, vscode.CompletionItemKind.Method);
		completionItemGet.DOC = { "CLIENT": true, "SERVER": true, "RETURNS": [{ "TYPE": varType }], "NETWORKVAR": varType, "SEARCH": ctx + ":Get" + varName };
		completionItemGet.insertText = GetFunc;

		var completionItemSet = new vscode.CompletionItem(ctx + ":Set" + varName, vscode.CompletionItemKind.Method);
		completionItemSet.DOC = { "CLIENT": true, "SERVER": true, "ARGUMENTS": [{ "TYPE": varType, "NAME": varName }], "NETWORKVAR": varType, "SEARCH": ctx + ":Set" + varName };
		completionItemSet.insertText = SetFunc;

		if (!(GetFunc in workspaceTokenData.signatures.metaFunctions)) workspaceTokenData.signatures.metaFunctions[GetFunc] = [];
		workspaceTokenData.signatures.metaFunctions[GetFunc].push(completionItemGet.DOC);
		if (!(SetFunc in workspaceTokenData.signatures.metaFunctions)) workspaceTokenData.signatures.metaFunctions[SetFunc] = [];
		workspaceTokenData.signatures.metaFunctions[SetFunc].push(completionItemSet.DOC);
		
		TokenIntellisenseProvider.addUniqueCompletionItem(completionItemGet, workspaceTokenData.completions.metaFunctions);
		TokenIntellisenseProvider.addUniqueCompletionItem(completionItemSet, workspaceTokenData.completions.metaFunctions);
	}

	addNetworkString(token, networkString, uri, is_ref) {
		if (GLuaParser.isTempGitHubDownload(uri)) return;

		let workspaceTokenData = this.getTokenData(uri);

		let completionItem = new vscode.CompletionItem(networkString, vscode.CompletionItemKind.Event);
		completionItem.DOC_TAG = false;
		TokenIntellisenseProvider.addUniqueCompletionItem(completionItem, workspaceTokenData.completions.networkStrings)

		if (token) {
			if (is_ref) {
				// net.Start
				if (!(networkString in workspaceTokenData.references.networkStrings)) workspaceTokenData.references.networkStrings[networkString] = [];
				workspaceTokenData.references.networkStrings[networkString].push(token);
			} else {
				// net.Receive
				if (!(networkString in workspaceTokenData.definitions.networkStrings)) workspaceTokenData.definitions.networkStrings[networkString] = [];
				workspaceTokenData.definitions.networkStrings[networkString].push(token);
			}
		}
	}
}

module.exports = {
	GLuaParser,
	TokenAnalyzer,
	TokenIntellisenseProvider,
	SCOPE_CONTROLLERS,
	// ENUM_TOKEN_TYPE,
	// TOKEN_TYPE,
};