// A lite Lua tokenizer which is specialized for this extension

const vscode = require("vscode");

const REGEXP_INSIDE_LUA_STR = /(?:("|')(?:(?:\\\1|\\\\|.)*?)(\1|$))|(?:\[(=*)\[(?:[\s\S]*?)(\]\3\]|$))/g;

const LUA_ESCAPE_SEQUENCES = {
	"a": "\u2407",
	"b": "[BS]",
	"f": "\f",
	"n": "\n",
	"r": "\r",
	"t": "\t",
	"v": "\v",
	"\\": "\\",
	"\"" : "\"",
	"'": "'",
};

const TOKENIZER_ALLOWED_VAR_NAME = /^[A-Za-z_][A-Za-z_0-9]*$/;
const TOKENIZER_FUNC_SPLIT = /:|\./g;

class Tokenizer {
	constructor(str) {
		this.token = "";
		this.invalidLua = false;

		this.openString = false;
		this.openMultilineString = false;
		this.openEscape = false;

		this.openParanthesis = [];
		this.openShortFuncCall = false; // e.g. AddCSLuaFile "whatever.lua"

		this.history = { 
			functionCallsClosed: [],
			functionCallsOpen: {},
		};

		if (str.length === 0) return;
		if (str.length > vscode.workspace.getConfiguration("editor").get("maxTokenizationLineLength")) return;

		this.tokenize(str);

		return;
	}

	functionCallOpen(i) {
		let func = [this.token];
		this.history.functionCallsOpen[func] = i - this.token.length - 1;
		this.openParanthesis.push(func);
		this.token = "";
	}

	functionCallClose(i) {
		let func = this.openParanthesis.pop();
		this.history.functionCallsClosed.push([func, this.history.functionCallsOpen[func], i + 1]);
		delete this.history.functionCallsOpen[func];
		this.token = "";
	}

	tokenize(str) {
		let i = -1;
		tokenize:
		while (i < str.length - 1) {
			i++;

			let char = str[i];

			if (this.openString) {

				if (this.openEscape) {
					if (char in LUA_ESCAPE_SEQUENCES) {
						this.openEscape = false;
						this.token += LUA_ESCAPE_SEQUENCES[char];
					} else {
						this.invalidLua = true;
						break tokenize;
					}
				} else if (char === "\\") {
					this.openEscape = true;
				} else if (char == this.openString) {
					this.openString = false;
					if (this.openShortFuncCall) {
						this.openParanthesis.pop();
						this.token = "";
					}
					this.openShortFuncCall = false;
				} else {
					this.token += char;
				}
				continue;

			} else if (this.openMultilineString !== false) {

				if (char === "]") {
					// Skip through and detect multiline string close
					let equals = 0;
					let tokenTail = "";
					let tokenCloseTail = "";
					while (i < str.length) {
						i++;
						switch(str[i]) {
							case "=": {
								equals += 1;
								break;
							}
							case "]": {
								if (equals == this.openMultilineString) {
									this.openMultilineString = false;
									this.token += tokenCloseTail;
									continue tokenize;
								}
								break;
							}
							default: tokenCloseTail += str[i];
						}
						tokenTail += str[i];
					}
					this.token += tokenTail;
				} else {
					this.token += char;
				}
				continue;

			} else {
				
				if (char === " " || char === "\t") continue;

				if (char === "[") {
					// Skip through and detect multiline string
					let equals = 0;
					multiline:
					while (i < str.length) {
						i++;
						switch(str[i]) {
							case "=": {
								equals += 1;
								continue;
							}
							case "[": {
								this.openMultilineString = equals;
								this.token = "";
								break multiline;
							}
							default:
								this.invalidLua = true;
								break tokenize;
						}
					}
					continue;
				}

				if (this.token === "local") {
					this.token = "";
					continue;
				}

				switch(char) {
					// case ";":
					case "\n":
						throw new Error("Tokenizer can only tokenize single lines");

					case "'":
					case "\"":
						if (this.token.length > 0) {
							this.openShortFuncCall = true;
							this.functionCallOpen(i);
						}
						this.openString = char;
						break;
				
					case "(":
						if (this.token.length > 0) {
							let funcSplit = this.token.split(TOKENIZER_FUNC_SPLIT);
							let funcValid = true;
							for (let j = 0; j < funcSplit.length; j++) {
								if (!funcSplit[j].match(TOKENIZER_ALLOWED_VAR_NAME)) {
									funcValid = false;
									break;
								}
							}
							if (funcValid) {
								this.functionCallOpen(i);
							} else {
								this.invalidLua = true;
								break;
							}
						} else {
							this.openParanthesis.push(false);
						}
						break;
		
					case ")":
						if (this.openParanthesis !== false) {
							this.functionCallClose(i);
							break;
						} else {
							this.invalidLua = true;
							break tokenize;
						}
			
					case ",":
						if (this.openShortFuncCall) {
							this.invalidLua = true;
							break tokenize;
						}
						if (this.openParanthesis.length > 0) {
							let func = this.openParanthesis[this.openParanthesis.length-1];
							if (func === false) {
								this.invalidLua = true;
								break tokenize;
							}
							func.push(this.token);
							this.token = "";
							break;
						}
					
					case "=":
						this.token = "";
						continue;
				
					case ".":
						if (str[i+1] === ".") {
							// String concatenation
							i++;
							break;
						}
					
					default:
						this.token += char;
				}

			}
		}
	}
}

module.exports = {
	Tokenizer,
	LUA_ESCAPE_SEQUENCES,
	REGEXP_INSIDE_LUA_STR
};