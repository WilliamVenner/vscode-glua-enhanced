// TODO possibly use the wiki scrape data to extract parameters from functions to autocomplete sounds/models/materials

const vscode = require("vscode");
const fs = require("fs");

const REGEXP_INSIDE_LUA_STR = /(?:("|')(?:(?:\\\1|\\\\|.)*?)(\1|$))|(?:\[(=*)\[(?:[\s\S]*?)(\]\3\]|$))/g;

const REGEXP_ENUM_COMPLETIONS = /((?:function|local)\s+)?(?<!\.|:)\b([A-Z][A-Z_\.]*)$/;
const REGEXP_FUNC_COMPLETIONS = /(?<!\B|:|\.)(?:(function)\s+)?([A-Za-z_][A-Za-z0-9_]*)(\.|:)(?:[A-Za-z_][A-Za-z0-9_]*)?$/;
const REGEXP_GLOBAL_COMPLETIONS = /^(?=([A-Za-z0-9_]*[A-Za-z_]))\1((?::|\.)(?:[A-Za-z0-9_]*[A-Za-z_])?)?(\s+noitcnuf\s+lacol)?/;
const REGEXP_FUNC_DECL_COMPLETIONS = /^[\t\t\f\v]*(local +)?(?:function +([A-Za-z_][A-Za-z0-9_]*)?|(funct?i?o?n?))((?::|\.)(?:[A-Za-z_][A-Za-z0-9_]*)?)?$/;
const REGEXP_HOOK_COMPLETIONS = /hook\.(Add|Remove|GetTable|Run|Call)\s*\((?:["']|\[=*\[)$/;
const REGEXP_VGUI_CREATE = /vgui\.Create\((?:["']|\[=*\[)$/;
const REGEXP_LUA_COMPLETIONS = /(?:(?:include|AddCSLuaFile|CompileFile)\s*\(\s*(?:["']|\[=*\[)(?:lua\/)?|lua\/)([^\s]+\/)?$/;
const REGEXP_MATERIAL_COMPLETIONS = /(?:(?:(?:(?::|\.)(?:SetImage|SetMaterial))|Material|surface\.GetTextureID)\s*\(\s*(?:["']|\[=*\[)(?:materials\/)?|materials\/)([^\s]+\/)?$/;
const REGEXP_SOUND_COMPLETIONS = /(?:(?:(?:(?::|\.)(?:EmitSound|StopSound|StartLoopingSound))|Sound|SoundDuration|sound\.Play(?:File)?|surface\.PlaySound|util\.PrecacheSound)\s*\(\s*(?:["']|\[=*\[)(?:sound\/)?|sound\/)([^\s]+\/)?/;
const REGEXP_MODEL_COMPLETIONS = /(?:(?:(?:(?::|\.)(?:SetModel|SetWeaponModel))|Model|IsUselessModel|ClientsideModel|CreatePhysCollidesFromModel|ents\.FindByModel|NumModelSkins|player_manager\.TranslateToPlayerModelName|util\.(?:PrecacheModel|GetModelInfo|GetModelMeshes|IsModelLoaded|IsValidModel|IsValidProp)|ents\.CreateClientProp)\s*\(\s*(?:["']|\[=*\[)(?:models\/)?|models\/)([^\s]+\/)?$/;

class CompletionProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.CompletionProvider = this;

		this.docs = this.GLua.WikiProvider.docs;

		this.createCompletionItems();
		this.initResources();
		this.registerSubscriptions();
	}

	initResources() {
		this.initSounds();
		this.initMaterials();

		console.log("vscode-glua initialized resources");
	}

	registerCompletionProvider(func, allowInStrings, ...triggerCharacters) {
		let CompletionProvider = this;
		this.GLua.extension.subscriptions.push(vscode.languages.registerCompletionItemProvider("glua", {
			resolveCompletionItem(item) { return CompletionProvider.GLua.WikiProvider.resolveCompletionItem(item) },
			provideCompletionItems(document, pos, cancel, ctx) {
				let term = CompletionProvider.getCompletionTerm(document, pos);
				if (!allowInStrings && CompletionProvider.isTermInsideString(pos, term)) return;
				return func(CompletionProvider, document, pos, cancel, ctx, term);
			}
		}, ...triggerCharacters));
	}

	registerSubscriptions() {
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

	initSounds() {
		let CompletionProvider = this;

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
				let traverseStack = CompletionProvider.sounds.all;
				let traverseStackGame = CompletionProvider.sounds[game];
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

		fs.readdir(this.GLua.extension.asAbsolutePath("resources/materials/icon16/"), (err, files) => {
			if (err) { console.warn("vscode-glua failed to read ../resources/materials/icon16/ (\"" + err + "\")") } else {
				for (let i = 0; i < files.length; i++) {
					let file = files[i];

					let completionItem = this.createCompletionItem(undefined, file, vscode.CompletionItemKind.File, undefined, file);
					completionItem.DOC_TAG = "materials/icon16/" + file;

					this.materials["icon16/"].items.push(completionItem);
					this.docs["materials/icon16/" + file] = { "RAW_IMAGE": this.GLua.extension.asAbsolutePath("resources/materials/icon16/" + file) };
				}
			}
		});

		fs.readdir(this.GLua.extension.asAbsolutePath("resources/materials/flags16/"), (err, files) => {
			if (err) { console.warn("vscode-glua failed to read ../resources/materials/flags16/ (\"" + err + "\")") } else {
				for (let i = 0; i < files.length; i++) {
					let file = files[i];

					let completionItem = this.createCompletionItem(undefined, file, vscode.CompletionItemKind.File, undefined, file);
					completionItem.DOC_TAG = "materials/flags16/" + file;

					this.materials["flags16/"].items.push(completionItem);
					this.docs["materials/flags16/" + file] = { "RAW_IMAGE": this.GLua.extension.asAbsolutePath("resources/materials/flags16/" + file) };
				}
			}
		});

		console.log("vscode-glua initialized materials");
	}

	provideArgumentCompletionItems(CompletionProvider, document, pos, cancel, ctx, term) {
		if (ctx.triggerCharacter === " " && !term.endsWith(", ")) return;

		let sigHelp = CompletionProvider.GLua.SignatureProvider.provideSignatureHelp(document, pos, cancel, ctx);
		if (sigHelp && sigHelp.signatures.length > 0) {
			let activeSignature = sigHelp.signatures[sigHelp.activeSignature];
			let activeParam = activeSignature.parameters[activeSignature.activeParameter];
			if (activeParam && "ENUM" in activeParam && activeParam["ENUM"] in CompletionProvider.enumFamilyCompletions) {
				return CompletionProvider.enumFamilyCompletions[activeParam["ENUM"]];
			}
		}
	}

	provideStringCompletionItems(CompletionProvider, document, pos, cancel, ctx, term) {
		let vgui_create = term.match(REGEXP_VGUI_CREATE);
		if (vgui_create) return CompletionProvider.panelCompletions;

		let hook_completions = term.match(REGEXP_HOOK_COMPLETIONS);
		if (hook_completions) {
			if (hook_completions[1] == "Call") {
				return CompletionProvider.hookCompletions;
			} else {
				return CompletionProvider.hookCompletions["GM"];
			}
		}
	}

	provideGeneralizedCompletionItems(CompletionProvider, document, pos, cancel, ctx, term) {
		if (term.length >= 3) {
			let enum_match = term.match(REGEXP_ENUM_COMPLETIONS);
			if (enum_match && !enum_match[1] && enum_match[2]) return CompletionProvider.enumCompletions;
		}

		let func_decl_match = term.match(REGEXP_FUNC_DECL_COMPLETIONS);
		if (func_decl_match && !func_decl_match[1]) {
			// Hack to make sure it replaces (function )EFFECT:...
			// TODO move to resolve? could be more optimized
			let range = new vscode.Range(pos.line, func_decl_match.index, pos.line, pos.character);
			for (let i = 0; i < CompletionProvider.functionDeclCompletions.items.length; i++) CompletionProvider.functionDeclCompletions.items[i].range = range;

			if (!func_decl_match[3] && (!func_decl_match[2] || func_decl_match[2].length === 0 || func_decl_match[2].toUpperCase() !== func_decl_match[2])) {
				return new vscode.CompletionList(CompletionProvider.genericFuncCompletions.items.concat(CompletionProvider.functionDeclCompletions.items), true);
			} else {
				return CompletionProvider.functionDeclCompletions;
			}
		}

		let specializedCompletions = CompletionProvider.provideSpecializedCompletionItems(CompletionProvider, document, pos, cancel, ctx, term);
		if (specializedCompletions) return;

		let term_reverse = "";
		for (var i = term.length - 1; i >= 0; i--) term_reverse += term[i];

		let global_match = term_reverse.match(REGEXP_GLOBAL_COMPLETIONS);
		if (global_match && !global_match[3]) {
			if (global_match[1]) {
				if (global_match[2]) {
					// function Global(.|:)whatever
					return CompletionProvider.metaFuncCompletions;
				} else {
					// function Global...
					return CompletionProvider.globalCompletions;
				}
			} else {
				return CompletionProvider.genericCompletions;
			}
		}
	}

	provideSpecializedCompletionItems(CompletionProvider, document, pos, cancel, ctx, term) {
		let func_match = term.match(REGEXP_FUNC_COMPLETIONS);
		if (func_match) {
			let func_ctx = func_match[1];
			let func_name = func_match[2];
			let func_call = func_match[3];
		
			// Check for hook definitions first
			if (func_call === ":" || (func_call === "." && func_ctx === "function")) {
				let hook_family = (func_name === "GAMEMODE" ? "GM" : func_name);
				if (hook_family in CompletionProvider.hookCompletions) {
					return CompletionProvider.hookCompletions[hook_family];
				}
			}

			// Then check for struct definition
			if (func_call === ".") {
				let struct = (func_name === "GAMEMODE" ? "GM" : func_name);
				if (struct in CompletionProvider.structCompletions) {
					return CompletionProvider.structCompletions[struct];
				}
			}

			if (func_name in CompletionProvider.libraryFuncCompletions) {
				if (CompletionProvider.libraryFuncCompletions[func_name] !== true) {
					return CompletionProvider.libraryFuncCompletions[func_name];
				} else if (func_ctx == "function") {
					return CompletionProvider.metaFuncCompletions;
				} else {
					// It's a confirmed library function, we don't want to show the meta functions, so we do nothing here.
				}
			} else if ((func_call === "." && func_ctx === "function") || (!func_ctx && (func_call === ":" || ctx.triggerKind === vscode.CompletionTriggerKind.Invoke))) {
				return CompletionProvider.metaFuncCompletions;
			}
		}
	}

	provideFilePathCompletionItem(CompletionProvider, document, pos, cancel, ctx, term) {
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

							CompletionProvider.workspace_model_files = new vscode.CompletionList(undefined, false);

							for (let i = 0; i < results.length; i++) {
								let file = results[i];
								let relPath = vscode.workspace.asRelativePath(file, showWorkspaceFolder);
								let relPathNoWorkspace = showWorkspaceFolder ? relPath.replace(/^.+?\//, "") : relPath;

								let folderTreeStack = CompletionProvider.workspace_model_files;
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
							
						} else delete CompletionProvider.workspace_model_files;

						resolve();
					
					}).catch(() => resolve);
				
				} else resolve();

			}).then(() => {

				if (CompletionProvider.workspace_model_files) {
					let traverseWorkspaceStack = CompletionProvider.workspace_model_files;

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

			let traverseStack = CompletionProvider.materials;
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

							CompletionProvider.workspace_material_files = new vscode.CompletionList(undefined, false);

							for (let i = 0; i < results.length; i++) {
								let file = results[i];
								let relPath = vscode.workspace.asRelativePath(file, showWorkspaceFolder);
								let relPathNoWorkspace = showWorkspaceFolder ? relPath.replace(/^.+?\//, "") : relPath;

								let folderTreeStack = CompletionProvider.workspace_material_files;
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
									CompletionProvider.docs[relPath] = { "VMT": file };
								} else {
									CompletionProvider.docs[relPath] = { "RAW_IMAGE": file.fsPath };
								}
							}
							
						} else delete CompletionProvider.workspace_material_files;

						resolve();
					
					}).catch(() => resolve);
				
				} else resolve();

			}).then(() => {

				if (CompletionProvider.workspace_material_files) {
					let traverseWorkspaceStack = CompletionProvider.workspace_material_files;

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
			
			let traverseStack = CompletionProvider.sounds.all;
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

							CompletionProvider.workspace_sound_files = new vscode.CompletionList(undefined, false);

							for (let i = 0; i < results.length; i++) {
								let file = results[i];
								let relPath = vscode.workspace.asRelativePath(file, showWorkspaceFolder);
								let relPathNoWorkspace = showWorkspaceFolder ? relPath.replace(/^.+?\//, "") : relPath;

								let folderTreeStack = CompletionProvider.workspace_sound_files;
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
							
						} else delete CompletionProvider.workspace_sound_files;

						resolve();
					
					}).catch(() => resolve);
				
				} else resolve();

			}).then(() => {

				if (CompletionProvider.workspace_sound_files) {
					let traverseWorkspaceStack = CompletionProvider.workspace_sound_files;

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

					this.GLua.SignatureProvider.registerSignature(completionItem, tag, item_def);
				}
			}
		}

		return completionItem;
	}

	createCompletionItems() {
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

		for (const [key, entries] of Object.entries(this.GLua.WikiProvider.wiki)) {
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
					let CompletionProvider = this;
					function step(entries, completions, prefix, is_package) {
						for (const [library, funcs] of Object.entries(entries)) {
							if ("MEMBERS" in funcs) {
								let completionItem = CompletionProvider.createCompletionItem(
									"PACKAGE",
									prefix + library,
									vscode.CompletionItemKind.Module,
									funcs,
									undefined,
									library
								);
								if (!is_package && !("DESCRIPTION" in funcs)) completionItem.DOC_TAG = false;
								(!completions.items ? CompletionProvider.globalCompletions : completions).items.push(completionItem);

								CompletionProvider.libraryFuncCompletions[prefix + library] = new vscode.CompletionList();
								step(funcs["MEMBERS"], CompletionProvider.libraryFuncCompletions[prefix + library], prefix + library + ".", false);
							} else {
								// Mark this as a package.function() function
								CompletionProvider.libraryFuncCompletions[prefix + library] = true;

								let completionItem = CompletionProvider.createCompletionItem(
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

module.exports = CompletionProvider;