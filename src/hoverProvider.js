const vscode = require("vscode");

const REGEXP_ASCII_HOVER = /(?:\\\d+)+/g;
const REGEXP_LUA_STR = /(?:("|')((?:\\\1|\\\\|.)*?)\1)|(?:\[(=*)\[([\s\S]*?)\]\3\])/g;
const INVALID_ESCAPE_SEQUENCE_HOVER = new vscode.MarkdownString("`invalid escape sequence`");

class HoverProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.HoverProvider = this;

		this.registerSubscriptions();
	}
	
	registerSubscriptions() {
		this.GLua.extension.subscriptions.push(vscode.languages.registerHoverProvider("glua", this));
	}

	provideHover(document, pos, cancel) {
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