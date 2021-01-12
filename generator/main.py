from scrape import *
from syntax import *
from language_server import *

import os, os.path
import json, re
import sys

def write_tmLanguage(syntax):
	if not os.path.isdir("../syntaxes"):
		os.mkdir("../syntaxes")

	print("Writing to syntaxes/lua.tmLanguage...")

	f = open("template/lua.tmLanguage", "r", encoding="utf-8")
	template = f.read()
	f.close()

	i = 0

	f = open("../syntaxes/lua.tmLanguage", "w", encoding="utf-8")

	for match in re.finditer(r"%_(.+?)_%", template):
		templateID = match.group(1)
		print("Writing %_{templateID}_%...".format(templateID = templateID))
		
		if templateID in syntax:
			f.write(template[i:match.start()])
			f.write(syntax[templateID])

			i = match.start() + len(match.group(0))
		else:
			print("ERROR: Missing %_{templateID}_%".format(templateID = templateID))

	f.write(template[i:])
	
	f.close()

def write_language_server_data(language_server_data):
	f = open("../wiki.json", "w", encoding="utf-8")
	f.write(json.dumps(language_server_data))
	f.close()

def main():
	if not os.path.isdir("scrape"):
		os.mkdir("scrape")

	if "--prescraped" in sys.argv and os.path.exists("scrape/scrape.json"):
		print("Using prescraped wiki...")
		f = open("scrape/scrape.json", "r", encoding="utf-8")
		wiki_scrape = json.loads(f.read())
		f.close()
	else:
		print("Scraping wiki...")
		wiki_scrape = scrape("--cached" in sys.argv)
	
	if wiki_scrape != None:
		#write_tmLanguage(syntax(wiki_scrape))
		write_language_server_data(language_server(wiki_scrape))

		print("Success")
		
		f = open("scrape/scrape.json", "w", encoding="utf-8")
		f.write(json.dumps(wiki_scrape))
		f.close()

		f = open("../resources/wiki.json", "w", encoding="utf-8")
		f.write(json.dumps(wiki_scrape))
		f.close()
	else:
		print("Failed to scrape wiki")

if __name__ == "__main__":
	main()