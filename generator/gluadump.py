# kind of horrible

import json

def gluadump(wiki_scrape):
	f = open("gluadump.json", "r") # https://github.com/WilliamVenner/gluadump
	gluadump = json.loads(f.read())
	f.close()

	# Resolves cyclic references by changing them to actual references
	# We obviously can't do this in JSON but we can in Python
	def find_cyclic(dump, cyclics={}, id_base=""):
		if type(dump) is list and not dump: return
		for name, entry in dump.items():
			id = id_base + name
			if "cyclic" in entry:
				for realm, cyclic in entry["cyclic"].items():
					if cyclic not in cyclics:
						cyclics[cyclic] = {}
					if realm not in cyclics[cyclic]:
						cyclics[cyclic][realm] = []
					if id not in cyclics[cyclic][realm]:
						cyclics[cyclic][realm].append(entry)
			if "members" in entry:
				find_cyclic(entry["members"], cyclics, id + ".")
		return cyclics
	
	def resolve_cyclic(cyclics, dump, id_base=""):
		if type(dump) is list and not dump: return
		for name, entry in dump.items():
			id = id_base + name

			if id in cyclics:
				for realm, cyclic_entries in cyclics[id].items():
					for cyclic_entry in cyclic_entries:
						if not "members" in cyclic_entry:
							cyclic_entry["members"] = {}
						cyclic_entry["members"] = cyclic_entry["members"] | entry["members"]
						del cyclic_entry["cyclic"]

			if "members" in entry:
				resolve_cyclic(cyclics, entry["members"], id + ".")

	resolve_cyclic(find_cyclic(gluadump), gluadump)

	def inject_src(dump, wiki):
		for name, entry in dump.items():
			if name in wiki:
				if ("FUNCTION" in wiki[name] or "METHOD" in wiki[name]) and "src" in entry:
					for realm, src in entry["src"].items():
						wiki[name]["SRC"] = [src[0], str(int(src[1])) + "-" + str(int(src[2]))]
						break
				if "members" in entry and "MEMBERS" in wiki[name]:
					inject_src(entry["members"], wiki[name]["MEMBERS"])
	
	for key in ["PANELS", "GLOBALS", "CLASSES"]:
		inject_src(gluadump, wiki_scrape[key])