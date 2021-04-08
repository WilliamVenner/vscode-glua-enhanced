"use strict";

const path = require("path");

const config = {
	target: "node",
	entry: "./src/extension.js",
	devtool: "source-map",
	externals: { vscode: "commonjs vscode", fs: "fs", debug: "debug" },
	resolve: { extensions: [".js"] },
	output: {
		path: path.resolve(__dirname, "dist"),
		filename: "extension.bundle.js",
        libraryTarget: 'commonjs2'
	},
	module: {
		rules: [
			{
				test: /\.m?js$/,
				exclude: /node_modules/,
				use: {
					loader: "babel-loader",
					options: {
						presets: ['@babel/preset-env']
					}
				}
			}
		]
	}
};

module.exports = config;