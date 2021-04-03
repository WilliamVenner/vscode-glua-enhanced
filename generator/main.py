from scrape import scrape
from gluadump import gluadump

import os, os.path
import json, re
import sys

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
		wiki_scrape = scrape("--cached" in sys.argv, "--quiet" in sys.argv)
	
	if wiki_scrape != None:
		gluadump(wiki_scrape)
		
		f = open("scrape/scrape.json", "w", encoding="utf-8")
		f.write(json.dumps(wiki_scrape))
		f.close()

		f = open("../resources/wiki.json", "w", encoding="utf-8")
		f.write(json.dumps(wiki_scrape))
		f.close()

		print("Success")
	else:
		print("Failed to scrape wiki")

if __name__ == "__main__":
	main()