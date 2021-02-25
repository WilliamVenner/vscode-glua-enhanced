<p align="center">
	<img alt="Logo" src="https://github.com/WilliamVenner/vscode-glua-enhanced/blob/master/resources/logo.png?raw=true"/>
</p>

# 👨‍💻 vscode-glua-enhanced

Supercharge your Garry's Mod development experience!

# Media

<details><summary>Click!</summary>

![](https://i.imgur.com/AklgD6Z.gif)

![](https://i.imgur.com/RzRw1PP.gif)

![](https://i.imgur.com/tPCzNIv.gif)

![](https://i.imgur.com/qoFhgWa.png)

![](https://i.imgur.com/OCb740O.png)

![](https://i.imgur.com/4PEOp4C.png)

![](https://i.imgur.com/EoB99zZ.png)

![](https://i.imgur.com/QRKMSh8.png)

![](https://i.imgur.com/X19jxT0.png)

</details>

## Features

* Syntax highlighting
* Auto completion & wiki integration for almost everything in Garry's Mod
* Client/Server/Menu flags
* ![](https://i.imgur.com/2SlS4Gc.png) flags
* Colour palette for `Color()`
* Notes, Warnings, Bugs, etcc. imported from wiki
* Function argument names, types and descriptions shown as you type
* Function enum arguments autocompletion
* File icons for `.lua`, `.vmt`, `.vtf`, `.mdl`, `*.vtx`, `.vvd`, `.phy`
* `.png` & `.vmt` file previews
* Workspace `models/`, `materials/`, `sound/` and `lua/` autocompletion file browser
* Default `sound/` autocompletion file browser
* Default `materials/flags16/` autocompletion file browser
* Default `materials/icon16/` autocompletion file browser
* "View Source" auto completions button to look at the GitHub Lua source of literally every Lua-defined function in Garry's Mod
* NetworkVar discovery and autocompletion
* Net message discovery and autocompletion
* Function signatures
* Hook callback signatures
* Hover documentation
* References & definitions
* Hover to see string length and cursor position
* Hover to decode Lua ASCII byte sequences
* Locals & globals autocompletion
* Global table autocompletion
* See definitions of functions defined in the [Garry's Mod Lua repository](https://github.com/Facepunch/garrysmod)
* Jump to global and local definitions

_And way more that I can't really be bothered to list because there are just too many :D_

### Workspace Globals Scanner

![](https://i.imgur.com/h9bRE4T.png)

### Global Calls Optimizer

![](https://i.imgur.com/o45kMdL.png)

### Bytecode Heatmap Generator

Generates a (very, VERY approximate) "heatmap" of how heavy some parts of your code are, and allows you to inspect what bytecode is being generated and where.

![](https://i.imgur.com/Z19qm3W.png)

Credits: [Spar](https://github.com/GitSparTV)

## Common Issues

#### Where are the file icons?!

Click the Gear icon in the bottom left of VSCode, click "File Icon Theme" and then select GLua.

#### _Auto completion documentation isn't showing up!_

Press `CTRL + Space`

#### I'm not seeing globals or local variables

You may have the `editor.quickSuggestions` setting set to `false`.

## Bugs/Feature Requests

Please [open an issue](https://github.com/WilliamVenner/vscode-glua-enhanced/issues) to report bugs and suggest features.

## Recommended Companion Extensions

### [glualint](https://marketplace.visualstudio.com/items?itemName=goz3rr.vscode-glualint)

A GLua linter, powered by [FPtje's glualint](https://github.com/FPtje/GLuaFixer).

## gluadump

This extension uses the [gluadump](https://github.com/WilliamVenner/gluadump) addon to extract some information (e.g. `debug.getinfo` data for the "View Source" buttons) from Garry's Mod and may need to periodically be updated as new features and libraries are added to Garry's Mod.

## Credits

[lua.tmLanguage](https://github.com/WilliamVenner/vscode-glua-enhanced/blob/master/syntaxes/lua.tmLanguage) taken from [FPtje/Sublime-GLua-Highlight](https://github.com/FPtje/Sublime-GLua-Highlight/)

Bytecode heatmap generator written by [Spar](https://github.com/GitSparTV) for [LLLua](https://github.com/GitSparTV/LLLua/)

[vtflib.js](https://github.com/meepen/vtflib.js) by [Meepen](https://github.com/meepen)

[gluac](https://github.com/everyday-as/gluac) made by Matt Stevens (MIT License)
