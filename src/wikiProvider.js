const vscode = require("vscode");
const escape = require("markdown-escape");

const WIKI_URL = "https://wiki.facepunch.com/gmod/";
const GITHUB_URL = "https://github.com/Facepunch/garrysmod/blob/master/garrysmod/";
const GITHUB_URL_RAW = "https://github.com/Facepunch/garrysmod/raw/master/garrysmod/";

class WikiProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.WikiProvider = this;

		this.initWiki();
	}

	static getSrcGitHubURL(src, raw) {
		return (raw ? GITHUB_URL_RAW : GITHUB_URL) + src[0] + "#" + (src[1].split("-").map((line) => "L" + line).join("-"));
	}

	getRealmIcon(client, menu, server) {
		if (!this.realmIcons) this.realmIcons = {};
		
		let realm_icon_id = (client ? "c" : "") + (menu ? "m" : "") + (server ? "s" : "");

		if (!(realm_icon_id in this.realmIcons)) {
			let full_path = "file:///" + this.GLua.extension.asAbsolutePath("resources/icons/realm_" + realm_icon_id + ".svg");
			this.realmIcons[realm_icon_id] = "![" + [client ? "CLIENT" : null, menu ? "MENU" : null, server ? "SERVER" : null].filter((v) => !!v).join("/") + "](" + this.markdownURL(full_path) + ")";
		}

		return this.realmIcons[realm_icon_id];
	}

	getLabelIcon(label) {
		if (!this.labelIcons) this.labelIcons = {};
		
		if (!(label in this.labelIcons)) {
			let full_path = "file:///" + this.GLua.extension.asAbsolutePath("resources/icons/label_" + label + ".svg");
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
		if ("NETWORKVAR" in doc) flags.push(this.getLabelIcon("networkvar"));
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
			links.push({ label: "$(source-control) View Source", link: WikiProvider.getSrcGitHubURL(doc["SRC"]) });
		}
		if (links.length > 0) markdown.push(links.map((link) => "[" + escape(link.label) + "](" + link.link + ")").join(" | "));

		return new vscode.MarkdownString(this.resolveWikiLinks(this.stripCodeFormatting(markdown.join("\n\n"))), true);
	}

	resolveCompletionItem(item) {
		if ("DOC_TAG" in item && item.DOC_TAG === false) return;

		let doc;

		if ("DOC" in item) {
			doc = item.DOC;
		} else {
			let DOC_TAG = "DOC_TAG" in item ? item.DOC_TAG : item.label;
			if (DOC_TAG in this.docs) doc = this.docs[DOC_TAG];
		}

		if (doc) {
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
					}, reject);
				});
			}

			item.documentation = this.resolveDocumentation(doc, item.label);

			if (doc["TAG"] === "ENUM") {
				item.detail = doc["VALUE"];
			} else if ("NETWORKVAR" in doc) {
				item.detail = "(" + doc["NETWORKVAR"] + ")";
			}

			return item;
		} else {
			console.warn("vscode-glua couldn't find \"" + item.label + "\" in wiki docs!");
		}
	}

	initWiki() {
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
		this.getLabelIcon("networkvar");

		this.wiki = require("../resources/wiki.json");
		this.docs = {};
	}
}

module.exports = WikiProvider;