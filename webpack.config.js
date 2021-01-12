"use strict";

const path = require("path");

const config = {
	target: "node",
	entry: "./src/extension.js",
	devtool: "source-map",
	externals: { vscode: "commonjs vscode", fs: "fs" },
	resolve: { extensions: [".js"] },
	output: {
		path: path.resolve(__dirname, "dist"),
		filename: "extension.bundle.js",
        libraryTarget: 'commonjs2'
	}
};

module.exports = config;