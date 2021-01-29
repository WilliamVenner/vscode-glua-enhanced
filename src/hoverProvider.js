const vscode = require("vscode");
const { TokenAnalyzer } = require("./gluaparse");

const REGEXP_ASCII_HOVER = /(?:\\\d+)+/g;
const REGEXP_LUA_STR = /(?:("|')((?:\\\1|\\\\|.)*?)\1)|(?:\[(=*)\[([\s\S]*?)\]\3\])/g;
const INVALID_ESCAPE_SEQUENCE_HOVER = new vscode.MarkdownString("`invalid escape sequence`");

const HOVER_GENERIC = 0;
const HOVER_ENUM = 1;

class HoverProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.HoverProvider = this;

		this.registerSubscriptions();
	}
	
	registerSubscriptions() {
		this.GLua.extension.subscriptions.push(vscode.languages.registerHoverProvider("glua", { provideHover: (document, pos, cancel) => this.provideWikiHover(this, document, pos, cancel) }));
		this.GLua.extension.subscriptions.push(vscode.languages.registerHoverProvider("glua", { provideHover: (document, pos, cancel) => this.provideStringHover(this, document, pos, cancel) }));
	}

	getHoverCallExpression(document, pos) {
		let token = this.GLua.GLuaParser.getTokenAt(document, pos);
		while (token) {
			if (token.type === "CallExpression") {
				let [full_call, range, targetToken] = TokenAnalyzer.qualifyMemberExpression(token, pos, true);
				if ("parent" in targetToken) {
					let parent = targetToken.parent;
					while (parent) {
						if (parent == token) {
							return [HOVER_GENERIC, full_call, range, targetToken];
						} else if ("parent" in parent) {
							parent = parent.parent;
						} else {
							break;
						}
					}
				}
			} else if (token.type === "Identifier") {
				if (!token.isLocal) {
					var tag = "ENUM:" + token.name;
					if (tag in this.GLua.WikiProvider.docs) {
						return [HOVER_ENUM, tag, null, token];
					}
				}
			}
			if ("parent" in token) token = token.parent;
			else break;
		}
		return [];
	}

	pushWikiHovers(hovers, docs) {
		for (let i = 0; i < docs.length; i++) {
			let doc = docs[i];

			hovers.push(new vscode.MarkdownString().appendCodeblock(
				(doc["EVENT"] ? "(hook) " : "") +
				(doc["METHOD"] ? "(method) " : "") +
				(doc["TAG"] === "ENUM" ? ("(enum) " + doc["SEARCH"]) :
					(doc["SEARCH"] + "(" +
						("ARGUMENTS" in doc ? this.GLua.SignatureProvider.generateSignatureString(doc["ARGUMENTS"]) : "")
					+ ")")
				)
			, "glua"));

			if ("RETURNS" in doc && doc["RETURNS"].length > 0) {
				let returns = "**Returns**\n\n";
				for (let i = 0; i < doc["RETURNS"].length; i++) {
					let ret = doc["RETURNS"][i];
					returns += (
						("NAME" in ret ?
							("**`" + ret["NAME"].replace(/`/g, "") + ":`**` " + ret["TYPE"].replace(/`/g, "") + "`") :
							("`" + ret["TYPE"].replace(/`/g, "") + "`")
						)
						+
						("DESCRIPTION" in ret ? " " + ret["DESCRIPTION"] : "")
					) + "\n\n";
				}
				hovers.push(new vscode.MarkdownString(returns.substr(0, returns.length-2)));
			}
			hovers.push(this.GLua.WikiProvider.resolveDocumentation(doc));
		}
	}

	provideWikiHover(HoverProvider, document, pos, cancel) {
		if (cancel.isCancellationRequested) return;

		let [hover_type, full_call, range, token] = HoverProvider.getHoverCallExpression(document, pos);
		if (token) {
			let hovers = [];
			
			switch(hover_type) {
				case HOVER_GENERIC:
					let callExpression = token.type === "CallExpression" ? token : (token.parent.type === "CallExpression" ? token.parent : undefined);
					if (callExpression) {
						if ("DOC" in callExpression) this.pushWikiHovers(hovers, callExpression["DOC"]);
						
						if (full_call.length >= 2 && full_call[full_call.length-2] === ":") {
							range = TokenAnalyzer.getTokenRange("identifier" in callExpression ? callExpression.identifier : (callExpression.base.type !== "Identifier" ? callExpression.base.identifier : callExpression.base));

							let meta_func = full_call[full_call.length-1];
							if (meta_func in this.GLua.TokenIntellisenseProvider.compiledTokenData.signatures.metaFunctions) {
								this.pushWikiHovers(hovers, this.GLua.TokenIntellisenseProvider.compiledTokenData.signatures.metaFunctions[meta_func]);
							}
						}
					}

					let LuaType = "LuaType" in token ? token["LuaType"] : undefined;
					if (!LuaType && !("DOC" in token) && (token.type === "Identifier" || token.type === "MemberExpression")) {
						// TODO
					}
					if (LuaType) hovers.push(new vscode.MarkdownString("**`" + LuaType.replace(/`/g, "") + "`**"));

					break;
				
				case HOVER_ENUM:
					this.pushWikiHovers(hovers, [this.GLua.WikiProvider.docs[full_call]]);
					break;
			}

			if (hovers.length > 0) return new vscode.Hover(hovers, range ? range : undefined);
		}
	}

	provideStringHover(HoverProvider, document, pos, cancel) {
		if (cancel.isCancellationRequested) return;
		
		let line = document.lineAt(pos);

		REGEXP_ASCII_HOVER.lastIndex = 0; // reset match position
		var match;
		while ((match = REGEXP_ASCII_HOVER.exec(line.text)) !== null) {
			try {
				let ascii_range = new vscode.Range(line.lineNumber, match.index, line.lineNumber, match.index + match[0].length);
				if (ascii_range.contains(pos)) {
					let bytes = String.fromCharCode(...match[0].split("\\"));
					return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(bytes, "glua"), ascii_range);
				}
			} catch(e) {}
		}
		
		REGEXP_LUA_STR.lastIndex = 0; // reset match position
		var match;
		while ((match = REGEXP_LUA_STR.exec(line.text)) !== null) {
			if (match[4]) continue; // Can't match multiline strings
			let str_range = new vscode.Range(line.lineNumber, match.index, line.lineNumber, match.index + match[0].length);
			if (str_range.contains(pos)) {
				let valid_str = true;
				let escaped = match[2].replace(/\\(.)/g, char => {
					if (char in LUA_ESCAPE_SEQUENCES) {
						return LUA_ESCAPE_SEQUENCES[char];
					} else {
						valid_str = false;
					}
				});
				if (!valid_str) return new vscode.Hover(INVALID_ESCAPE_SEQUENCE_HOVER, str_range);

				let utf8_len = (new TextEncoder()).encode(escaped).length;
				let cursor_pos = (match[0].length - ((match.index + match[0].length) - pos.character));

				return new vscode.Hover(
					"Length: " + escaped.length.toLocaleString() + " bytes" +
					(utf8_len !== escaped.length ? ("\n\nUTF-8: " + utf8_len.toLocaleString() + " characters") : "") +
					(cursor_pos > 0 && cursor_pos <= escaped.length ? ("\n\nPos: " + cursor_pos) : "")
				, str_range);
			}
		}
	}
}

module.exports = HoverProvider;