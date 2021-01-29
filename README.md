<p align="center">
	<img alt="Logo" src="https://github.com/WilliamVenner/vscode-glua-enhanced/blob/master/resources/logo.png?raw=true"/>
</p>

# 👨‍💻 vscode-glua-enhanced

Supercharge your Garry's Mod development experience!

**GLua Enhanced is currently in BETA and may have missing features and bugs.**

**BETA: Syntax highlighting is currently not up-to-date with the wiki**

## Features

* Auto completion & wiki integration for almost everything in Garry's Mod
* Client/Server/Menu flags
* ![](https://i.imgur.com/2SlS4Gc.png) flags
* Colour palette for `Color()`
* Notes, Warnings, Bugs, imported from wiki
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
* Workspace globals scanner
* Bytecode heatmap & inspection tool (credits: [Spar](https://github.com/GitSparTV))

(and way more features I have not actually listed at the moment!)

## Common Issues

#### Where are the file icons?!

Click the Gear icon in the bottom left of VSCode, click "File Icon Theme" and then select GLua.

#### _Auto completion documentation isn't showing up!_

Press `CTRL + Space`

#### _Where did my textual autocompletions go? Your extension broke them!_

[No it didn't](https://github.com/microsoft/vscode/issues/21611), see [Recommended Companion Extensions](https://github.com/williamvenner/vscode-glua-enhanced#recommended-companion-extensions)

#### I'm not seeing globals or local variables

You may have the `editor.quickSuggestions` setting set to `false`.

## Bugs/Feature Requests

Please [open an issue](https://github.com/WilliamVenner/vscode-glua-enhanced/issues) to report bugs and suggest features.

## Recommended Companion Extensions

### [All Autocomplete](https://marketplace.visualstudio.com/items?itemName=Atishay-Jain.All-Autocomplete)

Mixes textual autocompletions and extension-provided autocompletions, and also includes textual autocompletions from all files in your workspace.

## Media

soon™

## Wiki Integration

_\[Placeholder\]_

## gluadump

This extension uses the [gluadump](https://github.com/WilliamVenner/gluadump) addon to extract some information (e.g. `debug.getinfo` data for the "View Source" buttons) from Garry's Mod and may need to periodically be updated as new features and libraries are added to Garry's Mod.

## Credits

[lua.tmLanguage](https://github.com/WilliamVenner/vscode-glua-enhanced/blob/master/syntaxes/lua.tmLanguage) structure taken from [FPtje/Sublime-GLua-Highlight](https://github.com/FPtje/Sublime-GLua-Highlight/)

Bytecode heatmap generator written by [Spar](https://github.com/GitSparTV) for [LLLua](https://github.com/GitSparTV/LLLua/)

[gluac](https://github.com/everyday-as/gluac) made by Matt Stevens (MIT License)
