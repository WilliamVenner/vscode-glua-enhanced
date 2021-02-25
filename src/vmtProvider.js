const vscode = require("vscode");
const { VTFFile } = require("vtflib");
const { PNG } = require("pngjs");
const md5 = require("md5");
const TempFile = require("./tempFile");
const fs = require("fs");

const REGEXP_VMT_BASETEXTURE = /^[\t ]*("|)\$basetexture\1[\t ]+("|)(.+)\2$/img;

// 1.  Get cached vmt file
// 2.  Find vtf
// 3.  Compare cached temp png stat against vtf file stat
// 4a. Serve png
// 4b. Generate png

class VMTProvider {
	constructor(GLua) {
		this.GLua = GLua;
		this.GLua.VMTProvider = this;
		this.FileCache = {};
	}

	getCachedFile(uri) {
		return new Promise((resolve, reject) => {
			return (

				uri.fsPath in this.FileCache ?
					new Promise((resolve, reject) => {

						let [contents, cached] = this.FileCache[uri.fsPath];
						vscode.workspace.fs.stat(uri).then(stats => {
							if (stats.mtime > cached) {
								reject();
							} else {
								resolve(contents);
							}
						}, _ => {
							debugger;
						});

					})
				: Promise.reject()

			).then(resolve, () => {
				vscode.workspace.fs.readFile(uri).then(contents => {
					this.FileCache[uri.fsPath] = [contents, new Date()];
					resolve(contents);
				}, reject);
			});
		});
	}

	provideVMT(cancel, item, vmt_path) {
		return new Promise(resolve => {
			this.getCachedFile(vmt_path).then(contents => {

				try {
					var str = String.fromCharCode.apply(null, contents);
				} catch(err) { return resolve(item); }

				item.documentation = new vscode.MarkdownString("```json\n" + str.replace(/(`|\\)/g, "\\$1") + "\n```");

				let vtf_path; let match;
				REGEXP_VMT_BASETEXTURE.lastIndex = 0;
				while ((match = REGEXP_VMT_BASETEXTURE.exec(str)) !== null) {
					if (vtf_path) return resolve(item);
					vtf_path = "materials/" + match[3];
					if (vtf_path.substr(vtf_path.length-4) !== ".vtf") vtf_path += ".vtf";
				}

				if (!vtf_path) return resolve(item);

				new Promise((resolve, reject) => {

					vscode.workspace.findFiles(vtf_path, undefined, 2, cancel).then(results => {
						if (results.length !== 1) return reject();
						
						const vtf_path = results[0];
						const png_path = TempFile.getTempPath(md5(vtf_path.fsPath) + ".vtf.png");

						new Promise((resolve, reject) => {

							Promise.all([

								vscode.workspace.fs.stat(vtf_path),

								png_path ?
									new Promise((resolve, reject) => {
										fs.stat(png_path, (err, stats) => {
											if (err) return reject();
											resolve(stats);
										});
									})
								: Promise.reject()

							]).then(stats => stats[0].mtime > stats[1].mtime ? reject() : resolve(), reject);

						}).then(() => {

							// Use cached
							resolve(png_path);

						}, () => {
							
							// Generate PNG
							vscode.workspace.fs.readFile(vtf_path).then(contents => {

								let png;
								try {
									let vtfImages = new VTFFile(contents).getImages();
									if (vtfImages.length === 0) return reject();
									
									let vtf;
									for (let i = vtfImages.length-1; i >= 0; i--) {
										if (vtfImages[i].Width <= 256) {
											vtf = vtfImages[i];
											break;
										}
									}
									if (!vtf) vtf = vtfImages[vtfImages.length-1];
									
									png = new PNG({
										width: vtf.Width,
										height: vtf.Height,
										filterType: -1,
										inputColorType: 6,
										inputHasAlpha: true
									});

									png.data = vtf.toRGBA8888();

								} catch(err) { return reject(); }

								png.pack().pipe(fs.createWriteStream(png_path))
									.on("close", () => resolve(png_path))
									.on("error", reject);
							}, reject);

						});

					}, reject);

				}).then(png_path => {
					
					item.documentation = new vscode.MarkdownString("![](file:///" + this.GLua.WikiProvider.markdownURL(png_path) + ")\n\n" + item.documentation.value);
					resolve(item);

				}, () => resolve(item));

			}, () => resolve(item));
		});
	}
}

module.exports = VMTProvider;