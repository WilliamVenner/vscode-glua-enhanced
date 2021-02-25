const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const noop = () => {};

// Hilarious way to find the temp directory on the operating system
const TMP_DIR = (function() {
	if (process.platform === "win32") {
		if ("TMP" in process.env) {
			return process.env["TMP"];
		}
	} else {
		let tmpVars = ["TEMPDIR", "TMPDIR", "TEMP", "TMP"];
		for (let i = 0; i < tmpVars.length; i++) {
			if (tmpVars[i] in process.env) {
				return process.env[tmpVars[i]];
			}
		}

		if (fs.lstatSync("/tmp").isDirectory()) {
			return "/tmp";
		}
	}

	if (vscode.workspace.workspaceFolders.length > 0) {
		for (let i = 0; i < vscode.workspace.workspaceFolders.length; i++) {
			if (vscode.workspace.workspaceFolders[i].uri.scheme === "file") {
				return vscode.workspace.workspaceFolders[i].uri.fsPath;
			}
		}
	}

	let homeVar = process.platform === "win32" ? "USERPROFILE" : "HOME";
	if (homeVar in process.env) {
		return homeVar;
	}
})();

class TempFile {
	static getTempPath(name) {
		if (!TMP_DIR) return null;
		return path.join(TMP_DIR, "glua-enhanced", name);
	}

	constructor(GLua, name, contents) {
		this.GLua = GLua;
		this.name = name;
		this.contents = contents;
	}

	create() {
		return new Promise((resolve, reject) => {
			if (!TMP_DIR) {
				vscode.window.showErrorMessage("No temporary directory or suitable workspace directory was found on your operating system, sorry!");
				reject();
			} else {
				let tmpPath = TempFile.getTempPath(this.name);
				fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
				if (this.contents === -1) {
					// Open a file handle
					fs.open(tmpPath, "w", (err, fd) => {
						if (err) {
							vscode.window.showErrorMessage("Error: " + err);
							reject();
						} else {
							resolve([ tmpPath, fd, () => fs.close(fd), () => { fs.close(fd); this.dispose() } ]);
						}
					});
				} else if (this.contents === 0) {
					// Return a write stream
					resolve(fs.createWriteStream(tmpPath));
				} else {
					fs.writeFile(tmpPath, this.contents, { encoding: "utf-8" }, (err) => {
						delete this.contents;

						if (err) {
							vscode.window.showErrorMessage("Error: " + err);
							reject();
						} else {
							this.path = tmpPath;
							this.fsPath = vscode.Uri.file(this.path).fsPath;
							this.GLua.tmpFiles[this.fsPath] = this;
		
							resolve([ tmpPath, () => this.dispose() ]);
						}
					});
				}
			}
		});
	}

	dispose() {
		if (!this.path) return;
		
		if (this.fsPath in this.GLua.tmpFiles) delete this.GLua.tmpFiles[this.fsPath];
		
		fs.unlink(this.path, noop);

		delete this;
	}
}

module.exports = TempFile;