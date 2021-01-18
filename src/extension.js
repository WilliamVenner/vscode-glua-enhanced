const vscode = require("vscode");
const fs = require("fs");
const escape = require("markdown-escape");
const { Tokenizer, LUA_ESCAPE_SEQUENCES } = require("./tokenizer");

const WIKI_URL = "https://wiki.facepunch.com/gmod/";
const GITHUB_URL = "https://github.com/Facepunch/garrysmod/blob/master/garrysmod/";

const REGEXP_COLOR = /(?<!\.|:)\b((?:surface\.Set(?:Draw|Text)|render\.(?:SetShadow|Fog)|mesh\.)?Color)(\s*\(\s*)((?<r>\d+)\s*,\s*(?<g>\d+)\s*,\s*(?<b>\d+)(?:\s*,\s*(?<a>\d+))?\s*)\)/g;
const REGEXP_COLOR_REPLACER = /(\d+)(\s*,\s*)(\d+)(\s*,\s*)(\d+)(?:(\s*,\s*)(\d+))?/;
const REGEXP_ENUM_COMPLETIONS = /((?:function|local)\s+)?(?<!\.|:)\b([A-Z][A-Z_\.]*)$/;
const REGEXP_FUNC_COMPLETIONS = /(?<!\B|:|\.)(?:(function)\s+)?([A-Za-z_][A-Za-z0-9_]*)(\.|:)(?:[A-Za-z_][A-Za-z0-9_]*)?$/;
const REGEXP_GLOBAL_COMPLETIONS = /^(?=([A-Za-z0-9_]*[A-Za-z_]))\1((?::|\.)(?:[A-Za-z0-9_]*[A-Za-z_])?)?(\s+noitcnuf\s+lacol)?/;
const REGEXP_FUNC_DECL_COMPLETIONS = /(local\s+)?(?:function\s+([A-Za-z_][A-Za-z0-9_]*)?|(funct?i?o?n?))((?::|\.)(?:[A-Za-z_][A-Za-z0-9_]*)?)?$/;
const REGEXP_INSIDE_LUA_STR = /(?:("|')(?:(?:\\\1|\\\\|.)*?)(\1|$))|(?:\[(=*)\[(?:[\s\S]*?)(\]\3\]|$))/g;

// String completions
const REGEXP_HOOK_COMPLETIONS = /hook\.(Add|Remove|GetTable|Run|Call)\s*\((?:["']|\[=*\[)$/;
const REGEXP_VGUI_CREATE = /vgui\.Create\((?:["']|\[=*\[)$/;

// File completions
// TODO possibly use the wiki scrape data to extract parameters from functions to autocomplete sounds/models/materials
const REGEXP_LUA_COMPLETIONS = /(?:(?:include|AddCSLuaFile|CompileFile)\s*\(\s*(?:["']|\[=*\[)(?:lua\/)?|lua\/)([^\s]+\/)?$/;
const REGEXP_MATERIAL_COMPLETIONS = /(?:(?:(?:(?::|\.)(?:SetImage|SetMaterial))|Material|surface\.GetTextureID)\s*\(\s*(?:["']|\[=*\[)(?:materials\/)?|materials\/)([^\s]+\/)?$/;
const REGEXP_SOUND_COMPLETIONS = /(?:(?:(?:(?::|\.)(?:EmitSound|StopSound|StartLoopingSound))|Sound|SoundDuration|sound\.Play(?:File)?|surface\.PlaySound|util\.PrecacheSound)\s*\(\s*(?:["']|\[=*\[)(?:sound\/)?|sound\/)([^\s]+\/)?/;
const REGEXP_MODEL_COMPLETIONS = /(?:(?:(?:(?::|\.)(?:SetModel|SetWeaponModel))|Model|IsUselessModel|ClientsideModel|CreatePhysCollidesFromModel|ents\.FindByModel|NumModelSkins|player_manager\.TranslateToPlayerModelName|util\.(?:PrecacheModel|GetModelInfo|GetModelMeshes|IsModelLoaded|IsValidModel|IsValidProp)|ents\.CreateClientProp)\s*\(\s*(?:["']|\[=*\[)(?:models\/)?|models\/)([^\s]+\/)?$/;

// ASCII hover
const REGEXP_ASCII_HOVER = /(?:\\\d+)+/g;
const REGEXP_LUA_STR = /(?:("|')((?:\\\1|\\\\|.)*?)\1)|(?:\[(=*)\[([\s\S]*?)\]\3\])/g;
const INVALID_ESCAPE_SEQUENCE_HOVER = new vscode.MarkdownString("`invalid escape sequence`");

// Signature provider
const REGEXP_FUNC_CALL_TYPE = /^(.+)(:|\.)(.+?)$/;

class GLua {
	constructor(extension) {
		console.time("vscode-glua")
		console.log("vscode-glua loading...");

		this.extension = extension;

		this.initWiki();
		this.initResources();
		this.registerSubscriptions();

		console.log("vscode-glua activated");
		console.timeEnd("vscode-glua")
	}

	registerCompletionProvider(func, allowInStrings, ...triggerCharacters) {
		let GLua = this;
		this.extension.subscriptions.push(vscode.languages.registerCompletionItemProvider("glua", {
			resolveCompletionItem(item) { return GLua.resolveCompletionItem(item) },
			provideCompletionItems(document, pos, cancel, ctx) {
				let term = GLua.getCompletionTerm(document, pos);
				if (!allowInStrings && GLua.isTermInsideString(pos, term)) return;
				return func(GLua, document, pos, cancel, ctx, term);
			}
		}, ...triggerCharacters));
	}

	registerSubscriptions() {
		this.extension.subscriptions.push(vscode.languages.registerSignatureHelpProvider("glua", this, "(", ","));
		this.extension.subscriptions.push(vscode.languages.registerColorProvider("glua", this));
		this.extension.subscriptions.push(vscode.languages.registerHoverProvider("glua", this));

		this.registerCompletionProvider(this.provideFilePathCompletionItem, true, "/", "\"", "'", "[");
		this.registerCompletionProvider(this.provideStringCompletionItems, true, "\"", "'", "[");
		this.registerCompletionProvider(this.provideSpecializedCompletionItems, false, ".", ":", "(");
		this.registerCompletionProvider(this.provideArgumentCompletionItems, false, "(", ",", " ");
		this.registerCompletionProvider(this.provideGeneralizedCompletionItems, false);
	}

	getCompletionTerm(document, pos) {
		return document.lineAt(pos).text.substr(0, pos.character);
	}

	isTermInsideString(pos, term) {
		var match;
		while ((match = REGEXP_INSIDE_LUA_STR.exec(term)) !== null) {
			let str_range = new vscode.Range(pos.line, match.index, pos.line, match.index + match[0].length);
			if (str_range.contains(pos)) {
				return true;
			}
		}
		return false;
	}

	getRealmIcon(client, menu, server) {
		if (!this.realmIcons) this.realmIcons = {};
		
		let realm_icon_id = (client ? "c" : "") + (menu ? "m" : "") + (server ? "s" : "");

		if (!(realm_icon_id in this.realmIcons)) {
			let full_path = "file:///" + this.extension.asAbsolutePath("resources/icons/realm_" + realm_icon_id + ".svg");
			this.realmIcons[realm_icon_id] = "![" + [client ? "CLIENT" : null, menu ? "MENU" : null, server ? "SERVER" : null].filter((v) => !!v).join("/") + "](" + this.markdownURL(full_path) + ")";
		}

		return this.realmIcons[realm_icon_id];
	}

	getLabelIcon(label) {
		if (!this.labelIcons) this.labelIcons = {};
		
		if (!(label in this.labelIcons)) {
			let full_path = "file:///" + this.extension.asAbsolutePath("resources/icons/label_" + label + ".svg");
			this.labelIcons[label] = "![" + label.toUpperCase() + "](" + this.markdownURL(full_path) + ")";
		}

		return this.labelIcons[label];
	}

	stripCodeFormatting(str) {
		return str.replace(/```[\s\S]+?```/g, "_< ommitted code block >_").replace(/^[\t\r ]*/gm, "");
	}

	markdownURL(url) {
		return url.replace(/[\[\]]/g, "\\$1").replace(/\\/g, "\\\\").replace(/ /g, "%20");
	}

	resolveWikiLinks(markdown) {
		return markdown.replace(/\[(.+?)\]\(\/gmod\/(.+?)\)/g, "[$1](" + WIKI_URL + "$2)");
	}

	resolveDocumentation(doc, label, compact) {
		let markdown = [];

		if ("BASE_DESCRIPTION" in doc) markdown.push(doc["BASE_DESCRIPTION"]);
		
		let flags = [];
		
		if ("CLIENT" in doc || "MENU" in doc || "SERVER" in doc) flags.push(this.getRealmIcon(doc["CLIENT"], doc["MENU"], doc["SERVER"]));
		if ("NEW" in doc) flags.push(this.getLabelIcon("new"));
		if ("DEPRECATED" in doc) flags.push(this.getLabelIcon("deprecated"));
		if ("INTERNAL" in doc) flags.push(this.getLabelIcon("internal"));
		if ("REF_ONLY" in doc) flags.push(this.getLabelIcon("reference_only"));
		if ("PREDICTED" in doc) flags.push(this.getLabelIcon("predicted"));
		if (flags.length > 0) markdown.push(flags.join(" "));

		if (label) markdown.push("**" + escape(label) + "**")

		if (!compact) {

			if ("DESCRIPTION" in doc) markdown.push(doc["DESCRIPTION"]);

			if ("BUGS" in doc) doc["BUGS"].map((bug) => markdown.push(
				("ISSUE" in bug ? (" [🐞 **BUG: #" + bug.ISSUE + "**](https://github.com/facepunch/garrysmod-issues/issues/" + bug.ISSUE + ")") :
				("PULL" in bug ? (" [🐞 **BUG: PR #" + bug.PULL + "**](https://github.com/facepunch/garrysmod/pull/" + bug.PULL + ")") :
				"🐞 **BUG:**"))
			+ ("DESCRIPTION" in bug ? " " + bug.DESCRIPTION : "")));

			if ("NOTES" in doc) doc["NOTES"].map((note) => markdown.push("**📝 NOTE:** " + note));
			
		} else if (label) {
			if (markdown.length > 1) {
				markdown[0] = markdown[0] + " " + markdown[1];
				markdown.splice(1, 1);
			}
		}

		if ("WARNINGS" in doc) doc["WARNINGS"].map((warning) => markdown.push("**⚠️ WARNING:** " + warning));

		let links = [];
		if ("LINK" in doc) {
			links.push({ label: "$(notebook) Wiki", link: WIKI_URL + doc["LINK"] });
			links.push({ label: "$(edit) Edit", link: WIKI_URL + doc["LINK"].replace(/#(.*?)$/, "") + "~edit" });
		}
		if ("SRC" in doc) {
			links.push({ label: "$(source-control) View Source", link: GITHUB_URL + doc["SRC"][0] + "#" + (doc["SRC"][1].split("-").map((line) => "L" + line).join("-")) });
		}
		if (links.length > 0) markdown.push(links.map((link) => "[" + escape(link.label) + "](" + link.link + ")").join(" | "));

		return new vscode.MarkdownString(this.resolveWikiLinks(this.stripCodeFormatting(markdown.join("\n\n"))), true);
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
			let sigInfo = new vscode.SignatureInformation(this.generateSignatureString(docArguments), callbackDocumentation ? callbackDocumentation : ("SEARCH" in docs ? this.resolveDocumentation(docs, docs["SEARCH"], true) : undefined));
			sigInfo.activeParameter = arg_pos;
			for (let i = 0; i < arg_count; i++) {
				let arg = docArguments[i];
				
				let param = new vscode.ParameterInformation(this.generateTypeSignature(arg), "DESCRIPTION" in arg ? this.resolveDocumentation(arg).appendMarkdown(sigInfo.documentation ? "\n\n---" : "") : undefined);
				if ("ENUM" in arg) param.ENUM = arg["ENUM"];

				if (callback && arg_pos === i && "CALLBACK" in arg) {
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

				if (func_call === ":" && this.hookCompletions[library_or_meta]) {
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
				let activeParam = signatures[0].parameters[activeCallbackParameter];
				if ("CALLBACK_SIGNATURES" in activeParam) {
					return activeParam.CALLBACK_SIGNATURES;
				}
			}

			let sigHelp = new vscode.SignatureHelp();
			sigHelp.signatures = signatures;
			return sigHelp;
		}
	}

	resolveCompletionItem(item) {
		if (item.DOC_TAG === false) return;

		let DOC_TAG = "DOC_TAG" in item ? item.DOC_TAG : item.label;
		if (DOC_TAG in this.docs) {
			let doc = this.docs[DOC_TAG];

			if ("RAW_IMAGE" in doc) {
				item.documentation = new vscode.MarkdownString("![" + escape(item.label) + "](file:///" + this.markdownURL(doc["RAW_IMAGE"]) + ")");
				return item;
			}

			if ("VMT" in doc) {
				return new Promise((resolve, reject) => {
					vscode.workspace.fs.readFile(doc["VMT"]).then((contents) => {
						try {
							var str = String.fromCharCode.apply(null, contents);
							item.documentation = new vscode.MarkdownString("```json\n" + str.replace(/(`|\\)/g, "\\$1") + "\n```");
							resolve(item);
						} catch(err) { reject() }
					}).catch(reject);
				});
			}

			item.documentation = this.resolveDocumentation(doc, item.label);

			switch (doc["TAG"]) {
				case "ENUM":
					item.detail = doc["VALUE"];
					break;
			}

			return item;
		} else {
			console.warn("vscode-glua couldn't find \"" + item.label + "\" in wiki docs!");
		}
	}

	provideArgumentCompletionItems(GLua, document, pos, cancel, ctx, term) {
		if (ctx.triggerCharacter === " " && !term.endsWith(", ")) return;

		let sigHelp = GLua.provideSignatureHelp(document, pos, cancel, ctx);
		if (sigHelp && sigHelp.signatures.length > 0) {
			let activeSignature = sigHelp.signatures[sigHelp.activeSignature];
			let activeParam = activeSignature.parameters[activeSignature.activeParameter];
			if (activeParam && "ENUM" in activeParam && activeParam["ENUM"] in GLua.enumFamilyCompletions) {
				return GLua.enumFamilyCompletions[activeParam["ENUM"]];
			}
		}
	}

	provideStringCompletionItems(GLua, document, pos, cancel, ctx, term) {
		let vgui_create = term.match(REGEXP_VGUI_CREATE);
		if (vgui_create) return GLua.panelCompletions;

		let hook_completions = term.match(REGEXP_HOOK_COMPLETIONS);
		if (hook_completions) {
			if (hook_completions[1] == "Call") {
				return GLua.hookCompletions;
			} else {
				return GLua.hookCompletions["GM"];
			}
		}
	}

	provideGeneralizedCompletionItems(GLua, document, pos, cancel, ctx, term) {
		if (term.length >= 3) {
			let enum_match = term.match(REGEXP_ENUM_COMPLETIONS);
			if (enum_match && !enum_match[1] && enum_match[2]) return GLua.enumCompletions;
		}

		let func_decl_match = term.match(REGEXP_FUNC_DECL_COMPLETIONS);
		if (func_decl_match && !func_decl_match[1]) {
			// Hack to make sure it replaces (function )EFFECT:...
			// TODO move GLua to resolve? could be more optimized
			let range = new vscode.Range(pos.line, func_decl_match.index, pos.line, pos.character);
			for (let i = 0; i < GLua.functionDeclCompletions.items.length; i++) GLua.functionDeclCompletions.items[i].range = range;

			if (!func_decl_match[3] && (!func_decl_match[2] || func_decl_match[2].length === 0 || func_decl_match[2].toUpperCase() !== func_decl_match[2])) {
				return new vscode.CompletionList(GLua.genericFuncCompletions.items.concat(GLua.functionDeclCompletions.items), true);
			} else {
				return GLua.functionDeclCompletions;
			}
		}

		let specializedCompletions = GLua.provideSpecializedCompletionItems(GLua, document, pos, cancel, ctx, term);
		if (specializedCompletions) return;

		let term_reverse = "";
		for (var i = term.length - 1; i >= 0; i--) term_reverse += term[i];

		let global_match = term_reverse.match(REGEXP_GLOBAL_COMPLETIONS);
		if (global_match && !global_match[3]) {
			if (global_match[1]) {
				if (global_match[2]) {
					// function Global(.|:)whatever
					return GLua.metaFuncCompletions;
				} else {
					// function Global...
					return GLua.globalCompletions;
				}
			} else {
				return GLua.genericCompletions;
			}
		}
	}

	provideSpecializedCompletionItems(GLua, document, pos, cancel, ctx, term) {
		let func_match = term.match(REGEXP_FUNC_COMPLETIONS);
		if (func_match) {
			let func_ctx = func_match[1];
			let func_name = func_match[2];
			let func_call = func_match[3];
		
			// Check for hook definitions first
			if (func_call === ":" || (func_call === "." && func_ctx === "function")) {
				let hook_family = (func_name === "GAMEMODE" ? "GM" : func_name);
				if (hook_family in GLua.hookCompletions) {
					return GLua.hookCompletions[hook_family];
				}
			}

			// Then check for struct definition
			if (func_call === ".") {
				let struct = (func_name === "GAMEMODE" ? "GM" : func_name);
				if (struct in GLua.structCompletions) {
					return GLua.structCompletions[struct];
				}
			}

			if (func_name in GLua.libraryFuncCompletions) {
				if (GLua.libraryFuncCompletions[func_name] !== true) {
					return GLua.libraryFuncCompletions[func_name];
				} else if (func_ctx == "function") {
					return GLua.metaFuncCompletions;
				} else {
					// It's a confirmed library function, we don't want to show the meta functions, so we do nothing here.
				}
			} else if ((func_call === "." && func_ctx === "function") || (!func_ctx && (func_call === ":" || ctx.triggerKind === vscode.CompletionTriggerKind.Invoke))) {
				return GLua.metaFuncCompletions;
			}
		}
	}

	provideFilePathCompletionItem(GLua, document, pos, cancel, ctx, term) {
		if (cancel.isCancellationRequested) return;

		let lua_match = term.match(REGEXP_LUA_COMPLETIONS);
		if (lua_match) {
			return new Promise((resolve, reject) => {
				Promise.resolve(vscode.workspace.findFiles("lua/" + (lua_match[1] !== undefined ? lua_match[1] : "") + "**/*.lua", undefined, undefined, cancel)).then(results => {

					let showWorkspaceFolder = vscode.workspace.workspaceFolders === undefined ? false : vscode.workspace.workspaceFolders.length > 1;

					let completions = new vscode.CompletionList();
					for (let i = 0; i < results.length; i++) {
						let file = results[i];
						let relPath = vscode.workspace.asRelativePath(file, showWorkspaceFolder);
						let relPathNoWorkspace = showWorkspaceFolder ? relPath.replace(/^.+?\//, "") : relPath;

						let completionItem = new vscode.CompletionItem(relPath, vscode.CompletionItemKind.File);
						completionItem.DOC_TAG = false;

						let relPathNoLua = relPathNoWorkspace.substr("lua/".length);
						if (lua_match[1] !== undefined) relPathNoLua = relPathNoLua.substr(lua_match[1].length);
						completionItem.insertText = relPathNoLua;

						completions.items.push(completionItem);
					}

					resolve(completions);

				}).catch(reject);
			});
		}

		let models_match = term.match(REGEXP_MODEL_COMPLETIONS);
		if (models_match) {
			let path = (models_match[1] ? models_match[1] : "").split("/").filter((v) => v !== "").map((v) => v + "/");
		
			// Search workspace
			return new Promise(resolve => { new Promise(resolve => {

				if (ctx.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter) {
					// Refresh the model files cache

					Promise.resolve(vscode.workspace.findFiles("models/**/*.mdl", undefined, undefined, cancel)).then(results => {
						if (results && results.length > 0) {
							let showWorkspaceFolder = vscode.workspace.workspaceFolders === undefined ? false : vscode.workspace.workspaceFolders.length > 1;

							GLua.workspace_model_files = new vscode.CompletionList(undefined, false);

							for (let i = 0; i < results.length; i++) {
								let file = results[i];
								let relPath = vscode.workspace.asRelativePath(file, showWorkspaceFolder);
								let relPathNoWorkspace = showWorkspaceFolder ? relPath.replace(/^.+?\//, "") : relPath;

								let folderTreeStack = GLua.workspace_model_files;
								let relPathTree = relPathNoWorkspace.replace(/^models\//, "").split("/");
								for (let j = 0; j < relPathTree.length - 1; j++) {
									let folder = relPathTree[j] + "/";
									if (folder.length === 0) continue;

									if (!(folder in folderTreeStack)) {
										let folderCompletionItem = new vscode.CompletionItem(folder, vscode.CompletionItemKind.Folder);
										folderCompletionItem.DOC_TAG = false;
										folderCompletionItem.insertText = relPathTree[j];
										folderCompletionItem.sortText = "0";

										folderTreeStack.items.push(folderCompletionItem);
										folderTreeStack[folder] = new vscode.CompletionList(undefined, false);
									}

									folderTreeStack = folderTreeStack[folder];
								}

								let fileName = relPathTree[relPathTree.length - 1];
								
								let completionItem = new vscode.CompletionItem(fileName, vscode.CompletionItemKind.File);
								completionItem.sortText = "1";
								completionItem.DOC_TAG = false;
								folderTreeStack.items.push(completionItem);
							}
							
						} else delete GLua.workspace_model_files;

						resolve();
					
					}).catch(() => resolve);
				
				} else resolve();

			}).then(() => {

				if (GLua.workspace_model_files) {
					let traverseWorkspaceStack = GLua.workspace_model_files;

					for (let i = 0; i < path.length; i++) {
						if (path[i] in traverseWorkspaceStack) {
							traverseWorkspaceStack = traverseWorkspaceStack[path[i]];
						} else {
							traverseWorkspaceStack = null; break;
						}
					}

					resolve(traverseWorkspaceStack);
				} else {
					resolve(null);
				}

			}); });
		}

		let materials_match = term.match(REGEXP_MATERIAL_COMPLETIONS);
		if (materials_match) {
			let path = (materials_match[1] ? materials_match[1] : "").split("/").filter((v) => v !== "").map((v) => v + "/");

			let traverseStack = GLua.materials;
			for (let i = 0; i < path.length; i++) {
				if (path[i] in traverseStack)
					traverseStack = traverseStack[path[i]];
				else {
					traverseStack = null; break;
				}
			}
		
			// Search workspace
			return new Promise(resolve => { new Promise(resolve => {

				if (ctx.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter) {
					// Refresh the material files cache

					Promise.resolve(vscode.workspace.findFiles("materials/**/*.{png,vmt}", undefined, undefined, cancel)).then(results => {
						if (results && results.length > 0) {
							let showWorkspaceFolder = vscode.workspace.workspaceFolders === undefined ? false : vscode.workspace.workspaceFolders.length > 1;

							GLua.workspace_material_files = new vscode.CompletionList(undefined, false);

							for (let i = 0; i < results.length; i++) {
								let file = results[i];
								let relPath = vscode.workspace.asRelativePath(file, showWorkspaceFolder);
								let relPathNoWorkspace = showWorkspaceFolder ? relPath.replace(/^.+?\//, "") : relPath;

								let folderTreeStack = GLua.workspace_material_files;
								let relPathTree = relPathNoWorkspace.replace(/^materials\//, "").split("/");
								for (let j = 0; j < relPathTree.length - 1; j++) {
									let folder = relPathTree[j] + "/";
									if (folder.length === 0) continue;

									if (!(folder in folderTreeStack)) {
										let folderCompletionItem = new vscode.CompletionItem(folder, vscode.CompletionItemKind.Folder);
										folderCompletionItem.DOC_TAG = false;
										folderCompletionItem.insertText = relPathTree[j];
										folderCompletionItem.sortText = "0";

										folderTreeStack.items.push(folderCompletionItem);
										folderTreeStack[folder] = new vscode.CompletionList(undefined, false);
									}

									folderTreeStack = folderTreeStack[folder];
								}

								let fileName = relPathTree[relPathTree.length - 1];
								
								let completionItem = new vscode.CompletionItem(fileName, vscode.CompletionItemKind.File);
								completionItem.sortText = "1";
								completionItem.DOC_TAG = relPath;
								folderTreeStack.items.push(completionItem);

								if (fileName.endsWith(".vmt")) {
									GLua.docs[relPath] = { "VMT": file };
								} else {
									GLua.docs[relPath] = { "RAW_IMAGE": file.fsPath };
								}
							}
							
						} else delete GLua.workspace_material_files;

						resolve();
					
					}).catch(() => resolve);
				
				} else resolve();

			}).then(() => {

				if (GLua.workspace_material_files) {
					let traverseWorkspaceStack = GLua.workspace_material_files;

					for (let i = 0; i < path.length; i++) {
						if (path[i] in traverseWorkspaceStack) {
							traverseWorkspaceStack = traverseWorkspaceStack[path[i]];
						} else {
							traverseWorkspaceStack = null; break;
						}
					}

					if (traverseStack && traverseWorkspaceStack) {
						resolve(new vscode.CompletionList(traverseStack.items.concat(traverseWorkspaceStack.items), false));
					} else {
						resolve(traverseWorkspaceStack ? traverseWorkspaceStack : (traverseStack ? traverseStack : null));
					}
				} else {
					resolve(traverseStack ? traverseStack : null);
				}

			}); });
		}

		let snd_match = term.match(REGEXP_SOUND_COMPLETIONS);
		if (snd_match) {
			let path = (snd_match[1] ? snd_match[1] : "").split("/").filter((v) => v !== "").map((v) => v + "/");
			
			let traverseStack = GLua.sounds.all;
			for (let i = 0; i < path.length; i++) {
				if (path[i] in traverseStack)
					traverseStack = traverseStack[path[i]];
				else {
					traverseStack = null; break;
				}
			}
		
			// Search workspace
			return new Promise(resolve => { new Promise(resolve => {

				if (ctx.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter) {
					// Refresh the sound files cache

					Promise.resolve(vscode.workspace.findFiles("sound/**/*.*", undefined, undefined, cancel)).then(results => {
						if (results && results.length > 0) {
							let showWorkspaceFolder = vscode.workspace.workspaceFolders === undefined ? false : vscode.workspace.workspaceFolders.length > 1;

							GLua.workspace_sound_files = new vscode.CompletionList(undefined, false);

							for (let i = 0; i < results.length; i++) {
								let file = results[i];
								let relPath = vscode.workspace.asRelativePath(file, showWorkspaceFolder);
								let relPathNoWorkspace = showWorkspaceFolder ? relPath.replace(/^.+?\//, "") : relPath;

								let folderTreeStack = GLua.workspace_sound_files;
								let relPathTree = relPathNoWorkspace.replace(/^sound\//, "").split("/");
								for (let j = 0; j < relPathTree.length - 1; j++) {
									let folder = relPathTree[j] + "/";
									if (folder.length === 0) continue;

									if (!(folder in folderTreeStack)) {
										let folderCompletionItem = new vscode.CompletionItem(folder, vscode.CompletionItemKind.Folder);
										folderCompletionItem.DOC_TAG = false;
										folderCompletionItem.insertText = relPathTree[j];
										folderCompletionItem.sortText = "00";

										folderTreeStack.items.push(folderCompletionItem);
										folderTreeStack[folder] = new vscode.CompletionList(undefined, false);
									}

									folderTreeStack = folderTreeStack[folder];
								}
								
								let completionItem = new vscode.CompletionItem(relPathTree[relPathTree.length - 1], vscode.CompletionItemKind.File);
								completionItem.DOC_TAG = false;
								completionItem.sortText = "01";
								folderTreeStack.items.push(completionItem);
							}
							
						} else delete GLua.workspace_sound_files;

						resolve();
					
					}).catch(() => resolve);
				
				} else resolve();

			}).then(() => {

				if (GLua.workspace_sound_files) {
					let traverseWorkspaceStack = GLua.workspace_sound_files;

					for (let i = 0; i < path.length; i++) {
						if (path[i] in traverseWorkspaceStack) {
							traverseWorkspaceStack = traverseWorkspaceStack[path[i]];
						} else {
							traverseWorkspaceStack = null; break;
						}
					}

					if (traverseStack && traverseWorkspaceStack) {
						resolve(new vscode.CompletionList(traverseStack.items.concat(traverseWorkspaceStack.items), false));
					} else {
						resolve(traverseWorkspaceStack ? traverseWorkspaceStack : (traverseStack ? traverseStack : null));
					}
				} else {
					resolve(traverseStack ? traverseStack : null);
				}

			}); });
		}
	}

	provideColorPresentations(color, ctx) {
		let result = ctx.document.getText(ctx.range).match(REGEXP_COLOR_REPLACER);
		let s = "";
		for (let i = 1; i <= 7; i++) {
			if (result[i] === undefined) continue;
			switch(i) {
				case 1:
					s += (color.red * 255).toFixed(0);
					break;
				
				case 3:
					s += (color.green * 255).toFixed(0);
					break;

				case 5:
					s += (color.blue * 255).toFixed(0);
					break;

				case 7:
					if (color.alpha != 1) s += (color.alpha * 255).toFixed(0);
					break;
				
				default:
					s += result[i];
					break;
			}
		}
		return [{ label: s }];
	}

	provideDocumentColors(document) {
		let documentColors = [];

		lines:
		for (var i = 0; i < document.lineCount; i++) {
			let line = document.lineAt(i).text;

			REGEXP_COLOR.lastIndex = 0; // reset match position

			let result;
			while ((result = REGEXP_COLOR.exec(line)) !== null) {
				documentColors.push(vscode.ColorInformation(
					new vscode.Range(i, result.index + result[1].length + result[2].length, i, result.index + result[1].length + result[2].length + result[3].length),
					new vscode.Color(result.groups["r"] / 255, result.groups["g"] / 255, result.groups["b"] / 255, result.groups["a"] != undefined ? (result.groups["a"] / 255) : 1)
				));
			}
		}

		return documentColors;
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

	createCompletionItem(tag, label, kind, item_def, display_label, insert_text) {
		let completionItem = new vscode.CompletionItem(display_label ? display_label : label, kind);

		completionItem.insertText = insert_text ? insert_text : label;
		
		if (display_label) {
			completionItem.filterText = label;
			completionItem.sortText = label;
		} else {
			completionItem.filterText = completionItem.insertText;
			completionItem.sortText = completionItem.insertText;
		}

		if (item_def) {
			if ("DEPRECATED" in item_def) completionItem.tags = [vscode.CompletionItemTag.Deprecated];

			if (tag) {
				item_def["TAG"] = tag

				if ("SEARCH" in item_def) {
					completionItem.DOC_TAG = tag + ":" + item_def["SEARCH"]
					if (completionItem.DOC_TAG in this.docs) {
						throw new Error("Duplicate doc search tag! (" + completionItem.DOC_TAG + ")");
					}
					this.docs[completionItem.DOC_TAG] = item_def;

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
		}

		return completionItem;
	}

	initSounds() {
		let GLua = this;

		this.sounds = { list: new vscode.CompletionList(undefined, false), all: new vscode.CompletionList(undefined, false) };

		let sound_game_sort = {"garrysmod": "1", "hl2": "2", "css": "3", "tf2": "4"};

		function step(game, sounds_tree) {
			for (const [folder, data] of Object.entries(sounds_tree.children)) {
				step(game, data);
			}
			for (let i = 0; i < sounds_tree.files.length; i++) {
				let file = sounds_tree.files[i];

				var completionItem = new vscode.CompletionItem(game + "! " + file, vscode.CompletionItemKind.File);
				completionItem.detail = "(" + game + ")";
				completionItem.DOC_TAG = false;
				completionItem.insertText = file;
				completionItem.sortText = game in sound_game_sort ? ("2" + sound_game_sort[game]) : "25";
				
				let folders = sounds_tree.path.replace(/\/$/, "").split("/");
				let traverseStack = GLua.sounds.all;
				let traverseStackGame = GLua.sounds[game];
				for (let j = 0; j < folders.length; j++) {
					let folder = folders[j] + "/";

					if (!(folder in traverseStack) || !(folder in traverseStackGame)) {
						let folderCompletionItem = new vscode.CompletionItem(game + "! " + folder, vscode.CompletionItemKind.Folder);
						folderCompletionItem.detail = completionItem.detail;
						folderCompletionItem.DOC_TAG = false;
						folderCompletionItem.insertText = folders[j];
						folderCompletionItem.sortText = game in sound_game_sort ? ("1" + sound_game_sort[game]) : "15";

						if (!(folder in traverseStack)) {
							traverseStack.items.push(folderCompletionItem);
							
							traverseStack[folder] = new vscode.CompletionList(undefined, false);
						}
						if (!(folder in traverseStackGame)) {
							let gameCompletionItem = Object.create(folderCompletionItem);
							gameCompletionItem.label = folder;
							traverseStackGame.items.push(gameCompletionItem);

							traverseStackGame[folder] = new vscode.CompletionList(undefined, false);
						}
					}

					traverseStack = traverseStack[folder];
					traverseStackGame = traverseStackGame[folder];
				
					if (j === folders.length - 1) {
						traverseStack.items.push(completionItem);
						
						let gameCompletionItem = Object.create(completionItem);
						gameCompletionItem.label = file;
						traverseStackGame.items.push(gameCompletionItem);
					}
				}

				var completionItem = Object.create(completionItem);
				completionItem.insertText = sounds_tree.path + file;
				completionItem.label = game + "! " + sounds_tree.path + file;
			}
		}
		for (const [game, sounds_tree] of Object.entries(require("../resources/sounds.json"))) {
			this.sounds[game] = new vscode.CompletionList(undefined, false);
			step(game, sounds_tree, sounds_tree.path);
		}

		console.log("vscode-glua initialized sounds");
	}

	initMaterials() {
		this.materials = new vscode.CompletionList();
		this.materials["icon16/"] = new vscode.CompletionList();
		this.materials["flags16/"] = new vscode.CompletionList();

		let icon16 = this.createCompletionItem(undefined, "icon16/", vscode.CompletionItemKind.Folder);
		icon16.DOC_TAG = false;
		icon16.sortText = "2";
		this.materials.items.push(icon16);

		let flags16 = this.createCompletionItem(undefined, "flags16/", vscode.CompletionItemKind.Folder);
		flags16.DOC_TAG = false;
		flags16.sortText = "3";
		this.materials.items.push(flags16);

		fs.readdir(this.extension.asAbsolutePath("resources/materials/icon16/"), (err, files) => {
			if (err) { console.warn("vscode-glua failed to read ../resources/materials/icon16/ (\"" + err + "\")") } else {
				for (let i = 0; i < files.length; i++) {
					let file = files[i];

					let completionItem = this.createCompletionItem(undefined, file, vscode.CompletionItemKind.File, undefined, file);
					completionItem.DOC_TAG = "materials/icon16/" + file;

					this.materials["icon16/"].items.push(completionItem);
					this.docs["materials/icon16/" + file] = { "RAW_IMAGE": this.extension.asAbsolutePath("resources/materials/icon16/" + file) };
				}
			}
		});

		fs.readdir(this.extension.asAbsolutePath("resources/materials/flags16/"), (err, files) => {
			if (err) { console.warn("vscode-glua failed to read ../resources/materials/flags16/ (\"" + err + "\")") } else {
				for (let i = 0; i < files.length; i++) {
					let file = files[i];

					let completionItem = this.createCompletionItem(undefined, file, vscode.CompletionItemKind.File, undefined, file);
					completionItem.DOC_TAG = "materials/flags16/" + file;

					this.materials["flags16/"].items.push(completionItem);
					this.docs["materials/flags16/" + file] = { "RAW_IMAGE": this.extension.asAbsolutePath("resources/materials/flags16/" + file) };
				}
			}
		});

		console.log("vscode-glua initialized materials");
	}

	initResources() {
		this.initSounds();
		this.initMaterials();

		console.log("vscode-glua initialized resources");
	}

	initWiki() {
		let GLua = this;

		// Precache the realm icons
		this.getRealmIcon(true, false, false);
		this.getRealmIcon(false, true, false);
		this.getRealmIcon(false, false, true);
		this.getRealmIcon(true, true, false);
		this.getRealmIcon(false, true, true);
		this.getRealmIcon(true, false, true);
		this.getRealmIcon(true, true, true);

		// Precache label icons
		this.getLabelIcon("internal");
		this.getLabelIcon("deprecated");
		this.getLabelIcon("reference_only");
		this.getLabelIcon("new");
		this.getLabelIcon("predicted");

		this.wiki = require("../resources/wiki.json");
		this.docs = {};

		this.genericCompletions = new vscode.CompletionList(undefined, true);      // contains enums, globals, libraries, panels
		this.genericFuncCompletions = new vscode.CompletionList(undefined, true);  // contains globals + meta functions
		this.enumCompletions = new vscode.CompletionList(undefined, true);         // enums only (also include structs because they're uppercase)
		this.globalCompletions = new vscode.CompletionList(undefined, true);       // globals only
		this.panelCompletions = new vscode.CompletionList(undefined, true);        // panels only
		this.functionDeclCompletions = new vscode.CompletionList(undefined, true); // Structs and hook families only
		this.metaFuncCompletions = new vscode.CompletionList(undefined, true);     // meta:Functions() only, but also include hooks here
		this.hookCompletions = new vscode.CompletionList();                        // hooks only
		this.enumFamilyCompletions = {}                                            // enum autocompletion during function signature
		this.libraryFuncCompletions = {};                                          // library.functions() only
		this.structCompletions = {};                                               // STRUCT and STRUCT.VAR = VAL only

		this.signatureProviders = {
			globals: {},
			functions: {},
			metaFunctions: {}
		};

		for (const [key, entries] of Object.entries(this.wiki)) {
			switch (key) {
				case "HOOKS":
					for (const [hook_family, hook_family_def] of Object.entries(entries)) {
						this.hookCompletions[hook_family] = new vscode.CompletionList();

						let add_to_meta = hook_family != "GM" && hook_family != "GAMEMODE";
						if (add_to_meta && !(hook_family in this.metaFuncCompletions)) this.metaFuncCompletions[hook_family] = {};
						for (const [hook_name, hook_def] of Object.entries(hook_family_def["MEMBERS"])) {
							let completionItem = this.createCompletionItem(
								"HOOK",
								hook_name,
								vscode.CompletionItemKind.Event,
								hook_def,
								hook_family + ":" + hook_name
							);
							if (add_to_meta) this.metaFuncCompletions.items.push(completionItem);
							this.hookCompletions[hook_family].items.push(completionItem);
							this.hookCompletions.items.push(completionItem);
						}

						this.functionDeclCompletions.items.push(this.createCompletionItem(
							"FUNC_DECL_HOOK",
							"function " + hook_family + ":",
							vscode.CompletionItemKind.Constructor,
							hook_family_def,
							hook_family + ":",
							"function " + hook_family
						));
						
						if (hook_family === "GM") {
							hook_family_def["SEARCH"] = "GAMEMODE"
							
							this.functionDeclCompletions.items.push(this.createCompletionItem(
								"FUNC_DECL_HOOK",
								"function GAMEMODE:",
								vscode.CompletionItemKind.Constructor,
								hook_family_def,
								"GAMEMODE:",
								"function GAMEMODE"
							));
						}
					}
					break;

				case "LIBRARIES":
					function step(entries, completions, prefix, is_package) {
						for (const [library, funcs] of Object.entries(entries)) {
							if ("MEMBERS" in funcs) {
								let completionItem = GLua.createCompletionItem(
									"PACKAGE",
									prefix + library,
									vscode.CompletionItemKind.Module,
									funcs,
									undefined,
									library
								);
								if (!is_package && !("DESCRIPTION" in funcs)) completionItem.DOC_TAG = false;
								(!completions.items ? GLua.globalCompletions : completions).items.push(completionItem);

								GLua.libraryFuncCompletions[prefix + library] = new vscode.CompletionList();
								step(funcs["MEMBERS"], GLua.libraryFuncCompletions[prefix + library], prefix + library + ".", false);
							} else {
								// Mark this as a package.function() function
								GLua.libraryFuncCompletions[prefix + library] = true;

								let completionItem = GLua.createCompletionItem(
									"FUNCTION",
									prefix + library,
									"FUNCTION" in funcs ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Constant,
									funcs,
									undefined,
									library
								);
								if (!is_package && !("DESCRIPTION" in funcs)) completionItem.DOC_TAG = false;
								completions.items.push(completionItem);
							}
						}
					}
					step(entries, this.libraryFuncCompletions, "", true);
					break;

				case "CLASSES":
					for (const [class_name, data] of Object.entries(entries)) {
						for (const [func_name, func_def] of Object.entries(data["MEMBERS"])) {
							this.metaFuncCompletions.items.push(this.createCompletionItem(
								"META_FUNCTION",
								func_name,
								vscode.CompletionItemKind.Method,
								func_def,
								class_name + ":" + func_name
							));
						}
					}
					break;

				case "PANELS":
					for (const [panel_name, panel_def] of Object.entries(entries)) {
						let completionItem = this.createCompletionItem("PANEL", panel_name, vscode.CompletionItemKind.Constant, panel_def);
						this.panelCompletions.items.push(completionItem);
						this.globalCompletions.items.push(completionItem);

						if ("MEMBERS" in panel_def) {
							if (!(panel_name in this.libraryFuncCompletions)) {
								this.libraryFuncCompletions[panel_name] = new vscode.CompletionList();
							}
							for (const [panel_func, panel_func_def] of Object.entries(panel_def["MEMBERS"])) {
								if (typeof panel_func_def !== "object") continue;
								this.libraryFuncCompletions[panel_name].items.push(this.createCompletionItem("PANEL_FUNCTION", panel_func, vscode.CompletionItemKind.Method, panel_func_def));
							}
						}
					}
					break;

				case "STRUCTS":
					for (const [struct_name, struct_def] of Object.entries(entries)) {
						let completionItem = this.createCompletionItem("STRUCT", struct_name, vscode.CompletionItemKind.Struct, struct_def);

						this.globalCompletions.items.push(completionItem);

						let contains_a_function = false;

						this.structCompletions[struct_name] = new vscode.CompletionList(undefined, true);
						for (const [field_name, field_def] of Object.entries(struct_def["MEMBERS"])) {
							let is_func = ("TYPE" in field_def && field_def["TYPE"] === "function");

							this.structCompletions[struct_name].items.push(this.createCompletionItem(
								"STRUCT_FIELD",
								field_name,
								is_func ? vscode.CompletionItemKind.Event : vscode.CompletionItemKind.Struct,
								field_def,
								struct_name + "." + field_name,
								is_func ? field_name : (field_name + " = ")
							));

							if (!contains_a_function && is_func) contains_a_function = true;
						}
						
						if (contains_a_function && struct_name.toUpperCase() == struct_name) {
							this.functionDeclCompletions.items.push(this.createCompletionItem(
								"FUNC_DECL_STRUCT",
								"function " + struct_name + ":",
								vscode.CompletionItemKind.Struct,
								struct_def,
								struct_name + ":",
								"function " + struct_name
							));

							this.enumCompletions.items.push(completionItem);
						}
					}
					break;

				case "GLOBALS":
					for (const [global_name, global_def] of Object.entries(entries)) this.globalCompletions.items.push(this.createCompletionItem(
						"GLOBAL",
						global_name,
						vscode.CompletionItemKind.Function,
						global_def
					));
					break;

				case "ENUMS":
					for (const [enum_name, enum_def] of Object.entries(entries)) {
						if (!(enum_def["FAMILY"] in this.enumFamilyCompletions)) {
							this.enumFamilyCompletions[enum_def["FAMILY"]] = new vscode.CompletionList();
						}

						let completionItem = this.createCompletionItem(
							"ENUM",
							enum_name,
							vscode.CompletionItemKind.Enum,
							enum_def,
							enum_name,
							("REF_ONLY" in enum_def ? ("VALUE" in enum_def ? enum_def["VALUE"] : undefined) : undefined)
						);

						this.enumCompletions.items.push(completionItem);
						this.enumFamilyCompletions[enum_def["FAMILY"]].items.push(completionItem);
					}
					break;
			}
		}

		// Finally, a bit of extra data processing

		// Merge struct hooks into struct autocompletions
		for (const [struct_name, completions] of Object.entries(this.structCompletions)) {
			if (!(struct_name in this.hookCompletions)) continue;
			completions.items = completions.items.concat(this.hookCompletions[struct_name].items);
		}

		// Create generic completions
		this.genericCompletions.items = this.globalCompletions.items.concat(this.enumCompletions.items).concat(this.panelCompletions.items);

		// Create generic function completions
		this.genericFuncCompletions.items = this.globalCompletions.items.concat(this.metaFuncCompletions.items);

		console.log("vscode-glua parsed wiki data successfully");
	}
}

module.exports = {
	activate: (extension) => new GLua(extension),
	deactivate: () => {}
};