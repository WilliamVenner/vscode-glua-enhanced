import re

def add_library_functions(syntax, lib_funcs, prefix=""):
	immediate_child_funcs = []
	for library, funcs in lib_funcs:
		if type(funcs) is dict:
			if "SEARCH" in funcs:
				immediate_child_funcs.append(library)
			else:
				add_library_functions(syntax, funcs.items(), prefix + library + "\.")
	
	if len(immediate_child_funcs) > 0:
		syntax["LIBRARY_FUNCTIONS"] = syntax["LIBRARY_FUNCTIONS"] + "(" + prefix + "(" + "|".join(immediate_child_funcs) + "))" + "|"

def syntax(wiki_scrape):
	syntax = {}

	## Packages and Derma ##

	syntax["PACKAGES_AND_DERMA"] = "(" + "|".join(wiki_scrape["LIBRARIES"]) + ")" + "|" + "(" + "|".join(wiki_scrape["PANELS"]) + ")"

	## Meta Functions ##

	syntax["META_FUNCTIONS"] = ""

	for class_name, funcs in wiki_scrape["CLASSES"].items():
		for _, funcs in funcs["MEMBERS"].items():
			syntax["META_FUNCTIONS"] = syntax["META_FUNCTIONS"] + "|".join(funcs) + "|"

	syntax["META_FUNCTIONS"] = syntax["META_FUNCTIONS"][:-1]

	## Globals ##

	syntax["GLOBAL_FUNCTIONS"] = "|".join(wiki_scrape["GLOBALS"])

	## Enumerations ##

	# Compress enums down
	# e.g. ACT_BLAH_BLAH, ACT_BLAH_WOW -> ACT_BLAH_(BLAH|WOW)
	compressed_enums = {}
	for enum_name in sorted(wiki_scrape["ENUMS"].keys()):
		if "REF_ONLY" in wiki_scrape["ENUMS"][enum_name]: continue
		compressed_enums_level = compressed_enums
		for match in re.finditer(r".+?(?:_|\.|$)", enum_name):
			substr = match.group(0)
			if not substr in compressed_enums_level:
				compressed_enums_level[substr] = {}
			compressed_enums_level = compressed_enums_level[substr]
	
	syntax["ENUMS"] = ""
	def write_enums(compressed_enums):
		for enum_name, nest in compressed_enums.items():
			syntax["ENUMS"] = syntax["ENUMS"] + enum_name
			if len(nest) > 1:
				syntax["ENUMS"] = syntax["ENUMS"] + "("
				write_enums(nest)
				syntax["ENUMS"] = syntax["ENUMS"] + ")"
			syntax["ENUMS"] = syntax["ENUMS"] + "|"
		syntax["ENUMS"] = syntax["ENUMS"][:-1]
	write_enums(compressed_enums)

	## Hooks ##

	syntax["HOOKS"] = ""

	for hook_family, hooks in wiki_scrape["HOOKS"].items():
		if hook_family == "GM":
			syntax_prefix = "((GAMEMODE|GM|self)(\.|:))"
		else:
			syntax_prefix = "((" + hook_family + "|self)(\.|:))"

		syntax["HOOKS"] = syntax["HOOKS"] + "(" + syntax_prefix + "(" + "|".join(hooks["MEMBERS"]) + ")" + ")|"

	syntax["HOOKS"] = syntax["HOOKS"][:-1]

	## Library Functions ##

	syntax["LIBRARY_FUNCTIONS"] = "("
	add_library_functions(syntax, wiki_scrape["LIBRARIES"].items())
	syntax["LIBRARY_FUNCTIONS"] = syntax["LIBRARY_FUNCTIONS"][:-1] + ")"

	return syntax