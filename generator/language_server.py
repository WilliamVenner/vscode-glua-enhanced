def language_server(wiki_scrape):
	language_server_data = {}

	def step(into):
		for k, v in into.items():
			if not type(v) is dict: continue
			if "SEARCH" in v:
				def_copy = v.copy()
				del def_copy["SEARCH"]
				language_server_data[v["SEARCH"]] = def_copy
			else:
				step(v)
	step(wiki_scrape)

	return language_server_data