# kind of horrible

import json

def gluadump(wiki_scrape):
	f = open("gluadump.json", "r") # https://github.com/WilliamVenner/gluadump
	gluadump = json.loads(f.read())
	f.close()

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