const vscode = require("vscode");
const fs = require("fs");
const escape = require("markdown-escape");

const WIKI_URL = "https://wiki.facepunch.com/gmod/";
const GITHUB_URL = "https://github.com/Facepunch/garrysmod/blob/master/garrysmod/";

const REGEXP_COLOR = /\bColor\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\s*\)/g;
const REGEXP_COLOR_REPLACER = /\b(Color\s*\(\s*)(\d+)(\s*,\s*)(\d+)(\s*,\s*)(\d+)(?:(\s*,\s*)(\d+))?(\s*\))/;
const REGEXP_ENUM_COMPLETIONS = /(function \s*)?(?<!\.|:)\b([A-Z][A-Z_\.]*)$/;
const REGEXP_FUNC_COMPLETIONS = /(\S+?)(\.|:)$/;
const REGEXP_GLOBAL_COMPLETIONS = /^(?=([A-Za-z0-9_]*[A-Za-z_]))\1(?!\s*noitcnuf)/;

// String completions
const REGEXP_GAMEMODE_HOOK_COMPLETIONS = /hook\.(?:Add|Remove|GetTable|Run|Call)\s*\((?:["']|\[=*\[)/;
const REGEXP_VGUI_CREATE = /vgui\.Create\((?:["']|\[=*\[)$/;

// File completions
const REGEXP_LUA_COMPLETIONS = /(?:(?:include|AddCSLuaFile|CompileFile)\s*\(\s*(?:["']|\[=*\[)(?:lua\/)?|lua\/)([^\s]+\/)?/;
const REGEXP_MATERIAL_COMPLETIONS = /(?:(?:(?:(?::|\.)(?:SetImage|SetMaterial))|Material|surface\.GetTextureID)\s*\(\s*(?:["']|\[=*\[)(?:materials\/)?|materials\/)([^\s]+\/)?/;
const REGEXP_SOUND_COMPLETIONS = /(?:(?:(?:(?::|\.)(?:EmitSound|StopSound|StartLoopingSound|))|Sound|SoundDuration|sound\.Play|(sound\.PlayFile)|surface\.PlaySound|util\.PrecacheSound)\s*\(\s*(?:["']|\[=*\[)(?:sound\/)?|sound\/)(?:([^\s\/]+?)\s+)?([^\s]+\/)?/;
const REGEXP_ICON_COMPLETIONS = /(icon|flags)16\/$/;

class GLua {
	constructor(extension) {
		console.log("vscode-glua loading...");

		this.extension = extension;

		this.initWiki();
		this.initResources();
		this.registerSubscriptions();

		console.log("vscode-glua activated");
	}

	registerSubscriptions() {
		// this.extension.subscriptions.push(vscode.languages.registerSignatureHelpProvider("glua", this, "(", ","));
		this.extension.subscriptions.push(vscode.languages.registerColorProvider("glua", this));
		// this.extension.subscriptions.push(vscode.languages.registerHoverProvider("glua", this));

		let GLua = this;
		this.extension.subscriptions.push(vscode.languages.registerCompletionItemProvider("glua", {
			resolveCompletionItem(item) { return GLua.resolveCompletionItem(item) },
			provideCompletionItems(document, pos, cancel) { return GLua.provideFilePathCompletionItem(GLua.getCompletionTerm(document, pos), cancel) }
		}, "/", "\"", "'", "["));
		this.extension.subscriptions.push(vscode.languages.registerCompletionItemProvider("glua", {
			resolveCompletionItem(item) { return GLua.resolveCompletionItem(item) },
			provideCompletionItems(document, pos) { return GLua.provideStringCompletionItems(GLua.getCompletionTerm(document, pos)) }
		}, "\"", "'", "["));
		this.extension.subscriptions.push(vscode.languages.registerCompletionItemProvider("glua", {
			resolveCompletionItem(item) { return GLua.resolveCompletionItem(item) },
			provideCompletionItems(document, pos, token, ctx) { return GLua.provideSpecializedCompletionItems(GLua.getCompletionTerm(document, pos), ctx) }
		}, ".", ":", "("));
		this.extension.subscriptions.push(vscode.languages.registerCompletionItemProvider("glua", {
			resolveCompletionItem(item) { return GLua.resolveCompletionItem(item) },
			provideCompletionItems(document, pos) { return GLua.provideGeneralizedCompletionItems(GLua.getCompletionTerm(document, pos)) }
		}));
	}

	getRealmIcon(client, menu, server) {
		if (!this.realmIcons) this.realmIcons = {};
		
		let realm_icon_id = (client ? "c" : "") + (menu ? "m" : "") + (server ? "s" : "");

		if (!(realm_icon_id in this.realmIcons)) {
			let full_path = "file:///" + this.extension.asAbsolutePath("resources/icons/realm_" + realm_icon_id + ".svg");
			this.realmIcons[realm_icon_id] = "![" + [client ? "CLIENT" : null, menu ? "MENU" : null, server ? "SERVER" : null].filter((v) => !!v).join("/") + "](" + this.markdown_url(full_path) + ")";
		}

		return this.realmIcons[realm_icon_id];
	}

	getLabelIcon(label) {
		if (!this.labelIcons) this.labelIcons = {};
		
		if (!(label in this.labelIcons)) {
			let full_path = "file:///" + this.extension.asAbsolutePath("resources/icons/label_" + label + ".svg");
			this.labelIcons[label] = "![" + label.toUpperCase() + "](" + this.markdown_url(full_path) + ")";
		}

		return this.labelIcons[label];
	}

	sanitize_formatting(str) {
		return str.replace(/```[\s\S]+?```/g, "_< ommitted code block >_").replace(/^[\t\r ]*/gm, "");
	}

	markdown_url(url) {
		return url.replace(/[\[\]]/g, "\\$1").replace(/\\/g, "\\\\").replace(/ /g, "%20");
	}

	provideSignatureHelp(document, pos) {
		// TODO
	}

	// FIXME function xxx doesnt autocomplete meta tables

	resolveCompletionItem(item) {
		if (item.DOC_TAG === false) return;

		let DOC_TAG = "DOC_TAG" in item ? item.DOC_TAG : item.label;
		if (DOC_TAG in this.docs) {
			let doc = this.docs[DOC_TAG];

			if ("RAW_IMAGE" in doc) {
				item.documentation = new vscode.MarkdownString("![" + escape(item.label) + "](file:///" + this.markdown_url(doc["RAW_IMAGE"]) + ")");
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

			let markdown = [];

			if ("BASE_DESCRIPTION" in doc) markdown.push(doc["BASE_DESCRIPTION"]);
			
			let flags = [];
			
			if ("CLIENT" in doc || "MENU" in doc || "SERVER" in doc) flags.push(this.getRealmIcon(doc["CLIENT"], doc["MENU"], doc["SERVER"]));
			if ("DEPRECATED" in doc) flags.push(this.getLabelIcon("deprecated"));
			if ("INTERNAL" in doc) flags.push(this.getLabelIcon("internal"));
			if ("REF_ONLY" in doc) flags.push(this.getLabelIcon("reference_only"));
			markdown.push(flags.join(" "));

			markdown.push("**" + escape(item.label) + "**")

			if ("DESCRIPTION" in doc) markdown.push(doc["DESCRIPTION"]);

			if ("WARNINGS" in doc) doc["WARNINGS"].map((warning) => markdown.push("**⚠️ WARNING:** " + warning));

			if ("BUGS" in doc) doc["BUGS"].map((bug) => markdown.push(
				("ISSUE" in bug ? (" [🐞 **BUG: #" + bug.ISSUE + "**](https://github.com/facepunch/garrysmod-issues/issues/" + bug.ISSUE + ")") :
				("PULL" in bug ? (" [🐞 **BUG: PR #" + bug.PULL + "**](https://github.com/facepunch/garrysmod/pull/" + bug.PULL + ")") :
				"🐞 **BUG:**"))
			+ ("DESCRIPTION" in bug ? " " + bug.DESCRIPTION : "")));

			if ("NOTES" in doc) doc["NOTES"].map((note) => markdown.push("**📝 NOTE:** " + note));

			let links = [];
			if ("LINK" in doc) {
				links.push({ label: "$(notebook) Wiki", link: WIKI_URL + doc["LINK"] });
				links.push({ label: "$(edit) Edit", link: WIKI_URL + doc["LINK"].replace(/#(.*?)$/, "") + "~edit" });
			}
			if ("SRC" in doc) {
				links.push({ label: "$(source-control) View Source", link: GITHUB_URL + doc["SRC"][0] + "#" + (doc["SRC"][1].split("-").map((line) => "L" + line).join("-")) });
			}
			if (links.length > 0) markdown.push(links.map((link) => "[" + escape(link.label) + "](" + link.link + ")").join(" | "))
			
			item.documentation = new vscode.MarkdownString(this.sanitize_formatting(markdown.join("\n\n")), true);

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

	// TODO hook.Call should show all hooks, not just gm

	provideStringCompletionItems(term) {
		let vgui_create = term.match(REGEXP_VGUI_CREATE);
		if (vgui_create) return this.panelCompletions;

		if (term.match(REGEXP_GAMEMODE_HOOK_COMPLETIONS)) return this.hookCompletions["GM"];
	}

	provideGeneralizedCompletionItems(term) {
		let enum_match = term.match(REGEXP_ENUM_COMPLETIONS);
		if (enum_match && !enum_match[1] && enum_match[2]) return this.enumCompletions;

		let term_reverse = "";
		for (var i = term.length - 1; i >= 0; i--) term_reverse += term[i];

		let global_match = term_reverse.match(REGEXP_GLOBAL_COMPLETIONS);
		if (global_match) return this.globalCompletions;
	}

	provideSpecializedCompletionItems(term, ctx) {
		let func_match = term.match(REGEXP_FUNC_COMPLETIONS);
		if (func_match) {
			// Check for hook definitions first
			if (func_match[2] === ":") {
				let hook_family = (func_match[1] === "GAMEMODE" ? "GM" : func_match[1]);
				if (hook_family in this.hookCompletions) {
					return this.hookCompletions[hook_family];
				}
			}

			// Then check for struct definition
			if (func_match[2] === ".") {
				let struct = (func_match[1] === "GAMEMODE" ? "GM" : func_match[1]);
				if (struct in this.structCompletions) {
					return this.structCompletions[struct];
				}
			}

			if (func_match[1] in this.libraryFuncCompletions) {
				if (this.libraryFuncCompletions[func_match[1]] !== true) {
					return this.libraryFuncCompletions[func_match[1]];
				} else {
					// It's a confirmed library function, we don't want to show the meta functions, so we do nothing here.
				}
			} else if (func_match[2] === ":" || ctx.triggerKind === vscode.CompletionTriggerKind.Invoke) {
				return this.metaFuncCompletions;
			}
		}
	}

	provideFilePathCompletionItem(term, cancel) {
		if (cancel.isCancellationRequested) return;

		let icons_match = term.match(REGEXP_ICON_COMPLETIONS);
		if (icons_match){
			switch(icons_match[1]) {
				case "icon":
					return this.icon16;
				
				case "flags":
					return this.flags16;
			}
		}

		let materials_match = term.match(REGEXP_MATERIAL_COMPLETIONS);
		if (materials_match) {
			return new Promise((resolve, reject) => {
				Promise.resolve(vscode.workspace.findFiles("materials/" + (materials_match[1] !== undefined ? materials_match[1] : "") + "**/*.{png,vmt}", undefined, undefined, cancel)).then(results => {

					let showWorkspaceFolder = vscode.workspace.workspaceFolders === undefined ? false : vscode.workspace.workspaceFolders.length > 1;

					let completions = new vscode.CompletionList();
					for (let i = 0; i < results.length; i++) {
						let file = results[i];
						let relPath = vscode.workspace.asRelativePath(file, showWorkspaceFolder);
						let relPathNoWorkspace = showWorkspaceFolder ? relPath.replace(/^.+?\//, "") : relPath;

						let insertText = relPathNoWorkspace.substr("materials/".length);
						if (materials_match[1] !== undefined) insertText = insertText.substr(materials_match[1].length);
						
						let completionItem;
						if (relPath.endsWith(".vmt")) {
							insertText = insertText.substr(0, insertText.length - ".vmt".length);

							completionItem = new vscode.CompletionItem(relPath, vscode.CompletionItemKind.File);
							this.docs[relPath] = { "VMT": file };
						} else {
							completionItem = new vscode.CompletionItem(relPath, vscode.CompletionItemKind.File);
							this.docs[relPath] = { "RAW_IMAGE": file.fsPath };
						}

						completionItem.DOC_TAG = relPath;
						completionItem.insertText = insertText;

						completions.items.push(completionItem);
					}

					resolve(completions);

				}).catch(reject);
			});
		}

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

		let snd_match = term.match(REGEXP_SOUND_COMPLETIONS);
		if (snd_match) {
			// let func = snd_match[1];
			let game = (snd_match[2] ? (snd_match[2] in this.sounds ? snd_match[2] : "all") : "all");
			let path = (snd_match[3] ? snd_match[3] : "").split("/").filter((v) => v !== "").map((v) => v + "/");

			if (path == "") return this.sounds.list;

			let traverseStack = this.sounds[game];
			for (let i = 0; i < path.length; i++) {
				traverseStack = traverseStack[path[i]];
			}

			if (traverseStack) {
				return traverseStack;
			}
		}
	}

	getCompletionTerm(document, pos) { return document.lineAt(pos).text.substr(0, pos.character); }

	provideColorPresentations(color, ctx) {
		let result = REGEXP_COLOR_REPLACER.exec(ctx.document.getText(ctx.range));
		let s = "";
		for (let i = 1; i <= 9; i++) {
			if (i == 8) {
				// alpha
				if (color.alpha != 1) {
					s += (result[7] == null ? result[3] : result[7]) + (color.alpha * 255).toFixed(0);
				}
			} else if (i == 2) {
				// red
				s += (color.red * 255).toFixed(0);
			} else if (i == 4) {
				// green
				s += (color.green * 255).toFixed(0);
			} else if (i == 6) {
				// blue
				s += (color.blue * 255).toFixed(0);
			} else if (i !== 7) {
				s += result[i];
			}
		}
		return [{ label: s }];
	}

	provideDocumentColors(document) {
		let documentColors = [];

		lines:
		for (var i = 0; i < document.lineCount; i++) {
			let result;
			while ((result = REGEXP_COLOR.exec(document.lineAt(i).text)) !== null) {
				let components = [];
				for (let j = 1; j <= 4; j++) {
					if (result[j] == null) continue;
					if (components[i] < 0 || components[i] > 255) continue lines;
					components[j] = Number(result[j]);
				}

				documentColors.push({
					color: new vscode.Color(components[1] / 255, components[2] / 255, components[3] / 255, components[4] != null ? (components[4] / 255) : 1),
					range: new vscode.Range(i, result.index, i, result.index + result[0].length)
				});
			}
		}

		return documentColors;
	}

	provideHover(document, pos, cancel) {
		// TODO
	}

	createCompletionItem(tag, label, kind, item_def, display_label, insert_text) {
		let completionItem = new vscode.CompletionItem(display_label ? display_label : label, kind);

		if (display_label) {
			completionItem.filterText = label; completionItem.sortText = label;
			if (!insert_text) completionItem.insertText = label;
		}
		if (insert_text) completionItem.insertText = insert_text;

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
				}
			}
		}

		return completionItem;
	}

	// TODO fix sound/garrysmod /

	initSounds() {
		let GLua = this;

		this.sounds = { list: new vscode.CompletionList(undefined, true), all: new vscode.CompletionList(undefined, true) };

		let sound_game_sort = {"garrysmod": "1", "hl2": "2", "css": "3", "tf2": "4"};

		function step(game, sounds_tree) {
			for (const [folder, data] of Object.entries(sounds_tree.children)) {
				step(game, data);
			}
			for (let i = 0; i < sounds_tree.files.length; i++) {
				let file = sounds_tree.files[i];

				let displayPath = game + " " + sounds_tree.path + file;

				let completionItem = new vscode.CompletionItem(game + " " + displayPath, vscode.CompletionItemKind.File);
				completionItem.detail = "(" + game + ")";
				completionItem.DOC_TAG = false;
				completionItem.insertText = sounds_tree.path + file;
				completionItem.sortText = game in sound_game_sort ? ("1" + sound_game_sort[game]) : "15";

				GLua.sounds.list.items.push(Object.create(completionItem));
				completionItem.insertText = file;
				completionItem.label = game + " " + file;
				
				let folders = sounds_tree.path.replace(/\/$/, "").split("/");
				let traverseStack = GLua.sounds.all;
				let traverseStackGame = GLua.sounds[game];
				for (let j = 0; j < folders.length; j++) {
					let last = j === folders.length - 1;
					let folder = folders[j] + "/";

					if (!(folder in traverseStack) || !(folder in traverseStackGame)) {
						let folderCompletionItem = new vscode.CompletionItem(game + " " + folder, vscode.CompletionItemKind.Folder);
						folderCompletionItem.detail = completionItem.detail;
						folderCompletionItem.DOC_TAG = false;
						folderCompletionItem.insertText = folder;
						folderCompletionItem.sortText = game in sound_game_sort ? ("0" + sound_game_sort[game]) : "05";

						if (j === 0) {
							GLua.sounds.list.items.push(folderCompletionItem);
						}
						if (!(folder in traverseStack)) {
							traverseStack.items.push(folderCompletionItem);
							traverseStack[folder] = new vscode.CompletionList(undefined, true);
						}
						if (!(folder in traverseStackGame)) {
							traverseStackGame.items.push(folderCompletionItem);
							traverseStackGame[folder] = new vscode.CompletionList(undefined, true);
						}
					}
					traverseStack = traverseStack[folder];
					traverseStackGame = traverseStackGame[folder];
				
					if (last) {
						traverseStack.items.push(completionItem);
						traverseStackGame.items.push(completionItem);
					}
				}
			}
		}
		for (const [game, sounds_tree] of Object.entries(require("../resources/sounds.json"))) {
			this.sounds[game] = new vscode.CompletionList(undefined, true);
			step(game, sounds_tree, sounds_tree.path);
		}
	}

	initMaterials() {
		this.materials = { list: new vscode.CompletionList() };
		
		// TODO better materials browser (like sounds)
	}

	initResources() {
		this.initSounds();
		this.initMaterials();

		let GLua = this;

		this.flags16 = new vscode.CompletionList();
		fs.readdir(this.extension.asAbsolutePath("resources/materials/flags16/"), (err, files) => {
			if (err) { console.warn("vscode-glua failed to read ../resources/materials/flags16/ (\"" + err + "\")") } else {
				for (let i = 0; i < files.length; i++) {
					let file = files[i];
					let completionItem = this.createCompletionItem(undefined, file, vscode.CompletionItemKind.File, undefined, file);
					completionItem.DOC_TAG = "materials/flags16/" + file;
					GLua.flags16.items.push(completionItem);
					GLua.docs["materials/flags16/" + file] = { "RAW_IMAGE": this.extension.asAbsolutePath("resources/materials/flags16/" + file) };
				}
			}
		});

		this.icon16 = new vscode.CompletionList();
		fs.readdir(this.extension.asAbsolutePath("resources/materials/icon16/"), (err, files) => {
			if (err) { console.warn("vscode-glua failed to read ../resources/materials/icon16/ (\"" + err + "\")") } else {
				for (let i = 0; i < files.length; i++) {
					let file = files[i];
					let completionItem = this.createCompletionItem(undefined, file, vscode.CompletionItemKind.File, undefined, file);
					completionItem.DOC_TAG = "materials/icon16/" + file;
					GLua.icon16.items.push(completionItem);
					GLua.docs["materials/icon16/" + file] = { "RAW_IMAGE": this.extension.asAbsolutePath("resources/materials/icon16/" + file) };
				}
			}
		});

		console.log("vscode-glua initialized resources");
	}

	// TODO models/ browser

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
		this.getLabelIcon("new"); // TODO
		this.getLabelIcon("predicted"); // TODO

		this.wiki = require("../resources/wiki.json");
		this.docs = {};
		this.enumCompletions = new vscode.CompletionList();
		this.globalCompletions = new vscode.CompletionList();
		this.panelCompletions = new vscode.CompletionList();
		this.metaFuncCompletions = new vscode.CompletionList(); // also include hooks here
		this.hookCompletions = {};
		this.libraryFuncCompletions = {};
		this.structCompletions = {};

		for (const [key, entries] of Object.entries(this.wiki)) {
			switch (key) {
				case "HOOKS":
					for (const [hook_family, hooks] of Object.entries(entries)) {
						this.hookCompletions[hook_family] = new vscode.CompletionList();

						let add_to_meta = hook_family != "GM" && hook_family != "GAMEMODE";
						if (add_to_meta && !(hook_family in this.metaFuncCompletions)) this.metaFuncCompletions[hook_family] = {};
						for (const [hook_name, hook_def] of Object.entries(hooks["MEMBERS"])) {
							let completionItem = this.createCompletionItem(
								"HOOK",
								hook_name,
								vscode.CompletionItemKind.Event,
								hook_def,
								hook_family + ":" + hook_name
							);
							if (add_to_meta) this.metaFuncCompletions.items.push(completionItem);
							this.hookCompletions[hook_family].items.push(completionItem);
						}
					}
					break;

				case "LIBRARIES":
					function step(entries, completions, prefix) {
						for (const [library, funcs] of Object.entries(entries)) {
							if ("MEMBERS" in funcs) {
								(!completions.items ? GLua.globalCompletions : completions).items.push(GLua.createCompletionItem(
									"PACKAGE",
									prefix + library,
									vscode.CompletionItemKind.Module,
									funcs,
									undefined,
									library
								));

								GLua.libraryFuncCompletions[prefix + library] = new vscode.CompletionList();
								step(funcs["MEMBERS"], GLua.libraryFuncCompletions[prefix + library], prefix + library + ".");
							} else {
								// Mark this as a package.function() function
								GLua.libraryFuncCompletions[prefix + library] = true;

								completions.items.push(GLua.createCompletionItem(
									"FUNCTION",
									prefix + library,
									"FUNCTION" in funcs ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Constant,
									funcs,
									undefined,
									library
								));
							}
						}
					}
					step(entries, this.libraryFuncCompletions, "");
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
					for (const [struct_name, data] of Object.entries(entries)) {
						let completionItem = this.createCompletionItem("STRUCT", struct_name, vscode.CompletionItemKind.Struct, data);

						this.globalCompletions.items.push(completionItem);

						if (struct_name.toUpperCase() === struct_name) {
							// If the struct is all upper case it will be detected as an enum whilst the user types, so we'll cheekily add it into the enums too
							this.enumCompletions.items.push(completionItem);
						}

						this.structCompletions[struct_name] = new vscode.CompletionList();
						for (const [field_name, field_def] of Object.entries(data["MEMBERS"])) {
							this.structCompletions[struct_name].items.push(this.createCompletionItem(
								"STRUCT_FIELD",
								field_name,
								("TYPE" in field_def && field_def["TYPE"] === "function") ? vscode.CompletionItemKind.Event : vscode.CompletionItemKind.Struct,
								field_def,
								struct_name + "." + field_name,
								field_name + " = "
							));
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
					for (const [enum_name, enum_def] of Object.entries(entries)) this.enumCompletions.items.push(this.createCompletionItem(
						"ENUM",
						enum_name,
						vscode.CompletionItemKind.Enum,
						enum_def,
						undefined,
						("REF_ONLY" in enum_def ? ("VALUE" in enum_def ? enum_def["VALUE"] : undefined) : undefined)
					));
					break;
			}
		}

		// Finally, a bit of extra data processing

		// Stupid hack to merge D* named panels into Enums auto completions
		for (let i = 0; i < this.panelCompletions.items.length; i++) {
			if (this.panelCompletions.items[i].label.startsWith("D")) this.enumCompletions.items.push(this.panelCompletions.items[i]);
		}

		// Merge struct hooks into struct autocompletions
		for (const [struct_name, completions] of Object.entries(this.structCompletions)) {
			if (!(struct_name in this.hookCompletions)) continue;
			completions.items = completions.items.concat(this.hookCompletions[struct_name].items);
		}

		console.log("vscode-glua parsed wiki data successfully");
	}
}

module.exports = {
	activate: (extension) => new GLua(extension),
	deactivate: () => {}
};