const vscode = require("vscode");
const { TokenAnalyzer } = require("./gluaparse.js");

// FIXME spamming causes duplicates until file is parsed again
// FIXME it's faster for the interpreter to put upvalues nearer to where they're needed, so instead of putting them all at the top of the file, we should be putting them in the chunks they get referenced in

const greedyIdentifierExtractor = (token, callback_data) => {
	if (token.isLocal || ("base" in token && "indexer" in token.base && token.base.indexer === ":")) return false;
	if (token.DOC) callback_data.push(token.DOC);
};

const lazyIdentifierExtractor = token => {
	if (token.isLocal || ("base" in token && "indexer" in token.base && token.base.indexer === ":")) return false;
};

const RE_REPLACE_DOT = /\./g;
const RE_FILE_NAME = /([^\\\/]+?)\.lua$/;
const RE_REALM_PREFIX = /^(?:(?:sv|sh|cl)_|.+$)/;

const REALM_SHARED = 0;
const REALM_CLIENT = 1;
const REALM_SERVER = 2;
function get_realm(DOCS) {
	if (DOCS.length > 1) {

		let server = false; let client = false;
		for (let i = 0; i < DOCS.length; i++) {
			let DOC = DOCS[i];
			if ("SERVER" in DOC && "CLIENT" in DOC) return REALM_SHARED;

			if ("SERVER" in DOC)
				server = true;
			else if ("CLIENT" in DOC)
				client = true;
			
			if (server && client) return REALM_SHARED;
		}

		if (server) return REALM_SERVER;
		else if (client) return REALM_CLIENT;
		return REALM_SHARED;

	} else {

		let DOC = DOCS[0];
		if ("SERVER" in DOC && "CLIENT" in DOC) return REALM_SHARED;
		if ("SERVER" in DOC) return REALM_SERVER;
		if ("CLIENT" in DOC) return REALM_CLIENT;
		return REALM_SHARED;

	}
}

class GlobalsOptimizer {
	static optimize(greedy, file, tokens, workspaceEdit, fsPath) {
		return new Promise(resolve => {
			let insert_whitespace = tokens.LIST.length > 0 && "MIN" in tokens.LINES && tokens.LIST[1].loc.start.line-1 === tokens.LINES.MIN;
			let preoptimized = {};
			let optimize = {};

			let realms = {};
			
			if ("LocalStatement" in tokens.TYPES) {
				for (let i = 0; i < tokens.TYPES.LocalStatement.LIST.length; i++) {
					let LocalStatement = tokens.TYPES.LocalStatement.LIST[i];
					if (!("init" in LocalStatement) || !("variables" in LocalStatement)) continue;
					for (let j = 0; j < LocalStatement.variables.length; j++) {
						// Checks that the local statement is valid and is local x = x
						if (!(j in LocalStatement.init) || !LocalStatement.variables[j].isLocal || (LocalStatement.init[j].type !== "Identifier" && LocalStatement.init[j].type !== "MemberExpression")) continue;

						// Checks that the local statement is in the main chunk of the file
						if (!("parent" in LocalStatement) || LocalStatement.parent !== tokens.LIST[0]) continue;

						let full_call = TokenAnalyzer.getFullFunctionCall(LocalStatement.variables[j]);
						// It appears that the user is already optimizing this function
						preoptimized[full_call.join("")] = LocalStatement.variables[j].name;
						
						if (insert_whitespace && tokens.LIST[1] != LocalStatement) {
							// Don't insert a whitespace; user likely is already optimizing at the top of the file ¯\_(ツ)_/¯
							insert_whitespace = false;
						}
					}
				}
			}

			if ("CallExpression" in tokens.TYPES) {
				for (let i = 0; i < tokens.TYPES.CallExpression.LIST.length; i++) {
					let CallExpression = tokens.TYPES.CallExpression.LIST[i];

					if (!("base" in CallExpression)) continue;

					let [full_call, callback_data] = TokenAnalyzer.getFullFunctionCall(CallExpression, greedy ? greedyIdentifierExtractor : lazyIdentifierExtractor);
					if (!full_call) continue;
					let global = full_call.join("");

					if (!greedy || callback_data.length === 0) {
						// Lazy, or no wiki documentation was found, only optimize the first global lookup in a member expression (if applicable)
						// i.e. GAS.Config -> local GAS = GAS

						// Push replacement range to optimizables
						if (!(full_call[0] in optimize)) optimize[full_call[0]] = [];
						optimize[full_call[0]].push(TokenAnalyzer.getTokenRange(CallExpression.base));
					} else {
						// DEFINE_BASECLASS is the ONLY preprocessor statement in Garry's Mod, we have to skip it or it causes invalid syntax!
						if (full_call.length === 1 && full_call[0] === "DEFINE_BASECLASS") continue;

						// Wiki documentation found, we can optimize this
						if (!(global in optimize)) optimize[global] = [];

						// Push realm if we're a member expression
						if (full_call.length > 1 && !(global in realms)) realms[global] = get_realm(callback_data[0]);

						// Push replacement range to optimizables
						// Include the DOC for realm checking too!
						optimize[global].push(TokenAnalyzer.getTokenRange(CallExpression.base));
					}
				}
			}

			let optimized = false;
			for (let name in optimize) {
				optimized = true;

				let replacementExpression = name in preoptimized ? preoptimized[name] : name.replace(RE_REPLACE_DOT, "_");

				let needs_realm_constraint = true;
				let realm = (fsPath.match(RE_FILE_NAME)[1] || "").match(RE_REALM_PREFIX);
				switch(realm[0]) {
					case "sv_":
					case "cl_":
					case "init":
						needs_realm_constraint = false;
				}
				let realmExpression = needs_realm_constraint && name in realms && realms[name] !== REALM_SHARED ? (
					realms[name] === REALM_SERVER ? 'SERVER and ' : 'CLIENT and '
				) : '';

				let localStatement = "local " + replacementExpression + " = " + realmExpression + name + "\n";
				if (workspaceEdit) {
					// file in this case will be a URI
					workspaceEdit.insert(file, new vscode.Position(0, 0), localStatement);
				} else {
					// file in this case will be a TextEditor
					file.insert(new vscode.Position(0, 0), localStatement);
				}

				// If the replacementExpression is equal to the local name, we don't need to make any replacements
				if (replacementExpression === name) continue;

				let ranges = optimize[name];
				for (let i = 0; i < ranges.length; i++) {
					if (workspaceEdit) {
						// file in this case will be a URI
						workspaceEdit.replace(file, ranges[i], replacementExpression);
					} else {
						// file in this case will be a TextEditor
						file.replace(ranges[i], replacementExpression);
					}
				}
			}

			if (optimized && insert_whitespace) {
				if (workspaceEdit) {
					// file in this case will be a URI
					workspaceEdit.insert(file, new vscode.Position(0, 0), "\n");
				} else {
					// file in this case will be a TextEditor
					file.insert(new vscode.Position(0, 0), "\n");
				}
			}
			
			resolve(workspaceEdit);
		});
	}

	static optimizeBulk(GLua, files, greedy) {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Optimizing globals",
		}, (progress) => new Promise(resolve => {

			const increment = 1 / (files.length * 2);
			const incrementObj = { increment: increment };

			progress.report({ increment: 0, message: "Parsing files..." });

			let parseQueue = [];
			let workspaceEdit = new vscode.WorkspaceEdit;

			for (let i = 0; i < files.length; i++) {
				let file = files[i];
				if (file.fsPath in GLua.GLuaParser.parsedFiles) {
					progress.report(incrementObj);
					parseQueue.push(new Promise(resolve => {
						GlobalsOptimizer.optimize(greedy, file, GLua.GLuaParser.parsedFiles[file.fsPath], workspaceEdit, file.fsPath).then(() => {
							progress.report(incrementObj);
							resolve();
						});
					}));
				} else {
					parseQueue.push(new Promise(resolve => {
						GLua.GLuaParser.parseFile(file).then(tokens => {
							progress.report(incrementObj);
							GlobalsOptimizer.optimize(greedy, file, tokens, workspaceEdit, file.fsPath).then(() => {
								progress.report(incrementObj);
								resolve();
							});
						});
					}));
				}
			}

			Promise.all(parseQueue).then(() => {
				progress.report({ message: "Applying optimizations..." });
				vscode.workspace.applyEdit(workspaceEdit).then(resolve);
			});
		}));
	}
}

module.exports = { GlobalsOptimizer };