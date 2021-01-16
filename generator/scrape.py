# Somewhat cursed code below, good luck stranger

WIKI_URL = "https://wiki.facepunch.com"

import hashlib
import os, os.path
import re
import copy
from queue import Queue
from io import StringIO

from lxml.etree import tostring, strip_elements
from lxml import html
from lxml.cssselect import CSSSelector

import urllib3
http = urllib3.PoolManager()

def request(url, cached=False, cache_extension="html"):
	url_md5 = hashlib.md5(url.encode()).hexdigest()
	cached_path = "scrape/" + url_md5 + "." + cache_extension

	if cached and os.path.exists(cached_path):
		print("GET [scrape/{hash}.{extension}] {url}".format(hash = url_md5, url = url, extension=cache_extension))

		f = open(cached_path, "r", encoding="utf-8")
		cached_response = f.read()
		f.close()

		return cached_response

	print("GET " + url)

	response = http.request("GET", url)
	if response.status >= 200 and response.status < 300:
		body = response.data.decode("utf-8")

		f = open(cached_path, "w", encoding="utf-8")
		f.write(body)
		f.close()
		
		return body
	else:
		raise Exception("Got HTTP {status} code from GET {url}".format(status = response.status, url = url))

class WikiParser:
	PARSED: dict = {
		"GLOBALS": {},
		"HOOKS": {},
		"PANELS": {},
		"ENUMS": {},
		"CLASSES": {},
		"LIBRARIES": {},
		"STRUCTS": {},
	}

	LINKS: dict = {}
	def add_wiki_link(self, obj, elem, name, interpolate=False):
		if "href" in elem.attrib:
			link = elem.attrib["href"].removeprefix("/gmod/")
			obj["LINK"] = link
			if interpolate: self.LINKS[link] = name

	CLASS_DEFS: dict = {
		"depr": "DEPRECATED",
		"rm": "MENU",
		"rc": "CLIENT",
		"rs": "SERVER",
		"intrn": "INTERNAL",
		"event": "EVENT",
		"method": "METHOD",
		"f": "FUNCTION",
		"new": "NEW",
	}
	def add_class_defs(self, obj, classes, force_non_deprecated=False):
		for class_name, key in self.CLASS_DEFS.items():
			if force_non_deprecated and class_name == "depr":
				continue
			elif class_name in classes:
				obj[key] = True
	
	## Parsing Wiki Pages ##

	PAGE_PARSE_QUEUE: Queue = Queue()
	def queue_page_parse(self, func, *args):
		self.PAGE_PARSE_QUEUE.put((func, args))

	def process_page_parse_queue(self):
		while not self.PAGE_PARSE_QUEUE.empty():
			process, args = self.PAGE_PARSE_QUEUE.get()
			process(*args)

	REGEX_COMPRESS_NEWLINES = r"\n{3,}"
	def compress_newlines(self, text):
		return re.sub(self.REGEX_COMPRESS_NEWLINES, "\n\n", text).strip()

	def interpolate_wiki_links(self, elem):
		if len(elem) > 0:
			elem_copy = copy.deepcopy(elem)

			for child in elem_copy:
				if child.tag == "page":
					page = child.text_content().strip()
					link = "/gmod/" + page.replace(" ", "%20")
					if "text" in child.attrib:
						link_text = "[" + child.attrib["text"].strip() + "](" + link + ")"
					elif page.startswith("Enums/"):
						link_text = "[" + page[len("Enums/"):] + "](" + link + ")"
					elif page in self.LINKS:
						link_text = "[" + self.LINKS[page] + "](" + link + ")"
					else:
						link_text = "[" + page + "](" + link + ")"
					
					child.tail = link_text + (child.tail or '')

			strip_elements(elem_copy, "*", with_tail=False)
			
			text = elem_copy.text_content()
		else:
			text = elem.text_content()

		text = text.strip()
		if len(text) > 0:
			return text

	def get_wiki_page_markup(self, url):
		body = request(WIKI_URL + url.removeprefix(WIKI_URL) + "?format=text", self.USE_CACHE, "xml")
		return html.fromstring(body)

	# TODO parse <added>YYYY.MM.DD</added>
	# FIXME derma.SkinList

	def parse_view_source(self, item, item_def):
		for src in CSSSelector(":scope > file")(item):
			if "line" in src.attrib:
				item_def["SRC"] = [src.text_content(), src.attrib["line"].replace("L", "")]

	def parse_text_content(self, item, item_def):
		description = self.interpolate_wiki_links(item)
		if description:
			description = self.compress_newlines(description)
			if "DESCRIPTION" in item_def:
				item_def["DESCRIPTION"] = item_def["DESCRIPTION"] + "\n\n" + description
			else:
				item_def["DESCRIPTION"] = description
	
	def add_item_content_def(self, item, item_def):
		self.parse_text_content(item, item_def)
		
		sel_deprecated = CSSSelector(":scope > deprecated")
		sel_removed = CSSSelector(":scope > removed")
		sel_notes = CSSSelector(":scope > note")
		sel_warnings = CSSSelector(":scope > warning")
		sel_bugs = CSSSelector(":scope > bug")

		for deprecated in list(sel_deprecated(item)) + list(sel_removed(item)):
			deprecated_content = deprecated.text_content().strip()
			if len(deprecated_content) > 0:
				if not "DEPRECATED" in item_def or type(item_def["DEPRECATED"]) is bool:
					item_def["DEPRECATED"] = []
				item_def["DEPRECATED"].append(self.compress_newlines(deprecated_content))
			item.remove(deprecated)
		if "DEPRECATED" in item_def and type(item_def["DEPRECATED"]) is list:
			item_def["DEPRECATED"] = sorted(item_def["DEPRECATED"], key=len)
		
		for bug in sel_bugs(item):
			bug_def = {}
			if "pull" in bug.attrib:
				bug_def["PULL"] = bug.attrib["pull"]
			elif "issue" in bug.attrib:
				bug_def["ISSUE"] = bug.attrib["issue"]
			self.parse_text_content(bug, bug_def)

			if "BUGS" not in item_def:
				item_def["BUGS"] = []
			item_def["BUGS"].append(bug_def)

		for note in sel_notes(item):
			note_content = note.text_content().strip()
			if len(note_content) > 0:
				if not "NOTES" in item_def:
					item_def["NOTES"] = []
				item_def["NOTES"].append(self.compress_newlines(note_content))
			item.remove(note)
		if "NOTES" in item_def:
			item_def["NOTES"] = sorted(item_def["NOTES"], key=len)
		
		for warning in sel_warnings(item):
			warning_content = warning.text_content().strip()
			if len(warning_content) > 0:
				if not "WARNINGS" in item_def:
					item_def["WARNINGS"] = []
				item_def["WARNINGS"].append(self.compress_newlines(warning_content))
			item.remove(warning)
		if "WARNINGS" in item_def:
			item_def["WARNINGS"] = sorted(item_def["WARNINGS"], key=len)

	def parse_generic_func(self, item, item_def):
		if "FUNCTION" not in item_def and "EVENT" not in item_def:
			# We're looking at an actual category page here
			for cat in CSSSelector("cat")(item): item.remove(cat)
			self.add_item_content_def(item, item_def)
			return

		self.parse_view_source(CSSSelector("function")(item)[0], item_def)

		description_elem = CSSSelector("function > description")(item)
		if len(description_elem) > 0: self.add_item_content_def(description_elem[0], item_def)

		find_enum_links = CSSSelector(":scope > page")
		for arg in CSSSelector("function > args > arg")(item):
			if "ARGUMENTS" not in item_def:
				item_def["ARGUMENTS"] = []
			
			arg_def = {}
			if "name" in arg.attrib and len(arg.attrib["name"]) > 0:
				arg_def["NAME"] = arg.attrib["name"]
			if "type" in arg.attrib and len(arg.attrib["type"]) > 0:
				arg_def["TYPE"] = arg.attrib["type"]

				if arg_def["TYPE"] == "number":
					for page in find_enum_links(arg):
						link = page.text_content().strip()
						if link.startswith("Enums/"):
							arg_def["ENUM"] = link[len("Enums/"):]
			
			self.add_item_content_def(arg, arg_def)
			
			item_def["ARGUMENTS"].append(arg_def)

		for ret in CSSSelector("function > rets > ret")(item):
			if "RETURNS" not in item_def:
				item_def["RETURNS"] = []
			
			ret_def = {}
			if "name" in ret.attrib and len(ret.attrib["name"]) > 0:
				ret_def["NAME"] = ret.attrib["name"]
			if "type" in ret.attrib and len(ret.attrib["type"]) > 0:
				ret_def["TYPE"] = ret.attrib["type"]
				
			self.add_item_content_def(ret, ret_def)
			
			item_def["RETURNS"].append(ret_def)

	def parse_struct(self, struct_name, url, struct_def):
		body = self.get_wiki_page_markup(url)

		description_elem = CSSSelector(":scope > structure > description")(body)
		if len(description_elem) > 0: self.add_item_content_def(description_elem[0], struct_def)
		
		for field in CSSSelector("fields > item")(body):
			field_name = field.attrib["name"]

			field_def = {}
			field_def["SEARCH"] = struct_name + "." + field_name
			field_def["NAME"] = field_name
			field_def["TYPE"] = field.attrib["type"]
			if "default" in field.attrib and len(field.attrib["default"]) > 0:
				field_def["DEFAULT"] = field.attrib["default"]
			
			self.add_item_content_def(field, field_def)
			self.PARSED["STRUCTS"][struct_name]["MEMBERS"][field_name] = field_def

	def parse_function(self, url, func_def):
		self.parse_generic_func(self.get_wiki_page_markup(url), func_def)

	def parse_library(self, url, lib_def):
		body = self.get_wiki_page_markup(url)

		# Panel
		panel = CSSSelector("panel")(body)
		if len(panel) > 0:
			parent = CSSSelector(":scope > parent")(panel[0])
			if len(parent) > 0: lib_def["PARENT"] = parent[0].text_content()

			preview = CSSSelector(":scope > preview")(panel[0])
			if len(preview) > 0: lib_def["PREVIEW"] = preview[0].text_content()

			description_elem = CSSSelector(":scope > description")(panel[0])
			if len(description_elem) > 0: self.add_item_content_def(description_elem[0], lib_def)
			return

		# Library/Class
		summary_elem = CSSSelector("summary")(body)
		if len(summary_elem) > 0: self.add_item_content_def(summary_elem[0], lib_def)

	def parse_hook(self, url, hook_def):
		body = self.get_wiki_page_markup(url)

		predicted = CSSSelector("function > predicted")(body)
		if len(predicted) > 0 and predicted[0].text_content() == "Yes":
			hook_def["PREDICTED"] = True

		self.parse_generic_func(body, hook_def)

	def parse_enum(self, url, enum_def_base):
		body = self.get_wiki_page_markup(url)
		
		description_elem = CSSSelector("enum > description")(body)
		if len(description_elem) > 0: self.add_item_content_def(description_elem[0], enum_def_base)

		if "DESCRIPTION" in enum_def_base:
			enum_def_base["BASE_DESCRIPTION"] = enum_def_base["DESCRIPTION"]
			del enum_def_base["DESCRIPTION"]

		reference_only = False
		if "WARNINGS" in enum_def_base:
			new_warnings = []
			for warning in enum_def_base["WARNINGS"]:
				if "reference" in warning:
					reference_only = True
				else:
					new_warnings.append(warning)
			if len(new_warnings) == 0:
				del enum_def_base["WARNINGS"]
			else:
				enum_def_base["WARNINGS"] = new_warnings

		for enum in CSSSelector("items > item")(body):
			enum_name = enum.attrib["key"]

			enum_names = enum_name.split(" or ")
			while (len(enum_names) > 0):
				enum_name = enum_names.pop()

				enum_def = dict(enum_def_base)
				enum_def["SEARCH"] = enum_name
				enum_def["VALUE"] = enum.attrib["value"]
				enum_def["LINK"] = enum_def["LINK"] + "#" + enum_name
				if reference_only: enum_def["REF_ONLY"] = True
				
				self.add_item_content_def(enum, enum_def)
				self.PARSED["ENUMS"][enum_name] = enum_def

	## Parsing Sidebar ##

	def parse_globals(self, key, category_list, force_non_deprecated=False):
		for child in list(category_list):
			name = child.attrib["search"]

			generic_def = {}
			generic_def["SEARCH"] = name
			self.add_class_defs(generic_def, child.classes, force_non_deprecated)
			self.add_wiki_link(generic_def, child, name, True)
			self.PARSED[key][name] = generic_def
			
			self.queue_page_parse(self.parse_function, child.attrib["href"], generic_def)

	def parse_struct_category(self, category_list):
		for child in list(category_list):
			name = child.attrib["search"]

			struct_def = {}
			struct_def["MEMBERS"] = {}
			struct_def["SEARCH"] = name
			self.add_class_defs(struct_def, child.classes, force_non_deprecated=True)
			self.add_wiki_link(struct_def, child, name, True)
			self.PARSED["STRUCTS"][name] = struct_def

			self.queue_page_parse(self.parse_struct, name, child.attrib["href"], struct_def)

	def parse_subcategory(self, category, parsed, category_items, strip_name=""):
		for child in list(category_items):
			name = self.get_subcategory_name(child)

			subcategory_def = {}
			subcategory_def["MEMBERS"] = {}
			subcategory_def["SEARCH"] = name
			self.add_class_defs(subcategory_def, child.classes, force_non_deprecated=True)
			self.add_wiki_link(subcategory_def, child, name)
			parsed[name] = subcategory_def

			link = CSSSelector(":scope > summary > a.cm")(child)
			if link:
				self.queue_page_parse(self.parse_library, link[0].attrib["href"], subcategory_def)
				self.parse_subcategories(subcategory_def, child, deprecated="depr" in child.classes)
			else:
				link = CSSSelector("a.cm")(child)
				if link: self.queue_page_parse(self.parse_library, link[0].attrib["href"], subcategory_def)

	def parse_subcategories(self, parent_def, subcategory, deprecated=False):
		sel_category_list = CSSSelector(":scope > details")
		sel_category_item = CSSSelector(":scope > a")
		for item in CSSSelector(":scope > ul > li")(subcategory):
			category_item = sel_category_item(item)
			if len(category_item) >= 1:
				category_item = category_item[0]
				
				meta_func = category_item.attrib["search"].split(":")
				if len(meta_func) > 1:
					item_name = meta_func[1]
				else:
					item_name = category_item.text_content()

				member_def = {}
				member_def["SEARCH"] = category_item.attrib["search"]
				if deprecated: member_def["DEPRECATED"] = True
				self.add_class_defs(member_def, category_item.classes, force_non_deprecated=True)
				self.add_wiki_link(member_def, category_item, item_name)
				parent_def["MEMBERS"][item_name] = member_def

				self.queue_page_parse(self.parse_function, category_item.attrib["href"], member_def)
			else:
				item_name = self.get_subcategory_name(item)

				subcategory_def = {}
				subcategory_def["MEMBERS"] = {}
				self.add_class_defs(subcategory_def, item.classes, force_non_deprecated=True)
				self.add_wiki_link(subcategory_def, item, item_name)
				parent_def["MEMBERS"][item_name] = subcategory_def

				deprecated = deprecated or "depr" in item.classes
				self.parse_subcategories(subcategory_def, sel_category_list(item)[0], deprecated=deprecated)

	def get_subcategory_name(self, subcategory):
		return (CSSSelector("summary > a")(subcategory) or CSSSelector("a")(subcategory))[0].attrib["search"].strip().replace(" ", "_")

	def __init__(self, cached=False):
		self.USE_CACHE = cached

		self.TREE = html.fromstring(request(WIKI_URL + "/gmod/", self.USE_CACHE, "html"))

		# Discover panels first
		# Panels must be found first to ensure PANEL hooks are filtered out
		for panel in CSSSelector("a.cm.panel")(self.TREE):
			name = panel.attrib["search"]
			name = name.replace(" ", "_")
			self.PARSED["PANELS"][name] = {}

		# Register hooks
		for hook in CSSSelector("a.cm.event")(self.TREE):
			path = hook.attrib["search"].split(":")

			parent = path[0]
			member = path[1]

			# Don't include PANEL hooks
			if parent in self.PARSED["PANELS"]:
				continue
			
			# Make some adjustments
			parent_href = "/gmod/" + parent + "_HOOKS"
			if parent == "WEAPON":
				parent = "SWEP"
			elif parent == "ENTITY":
				parent = "ENT"

			if not parent in self.PARSED["HOOKS"]:
				hook_family_def = {}
				hook_family_def["MEMBERS"] = {}
				hook_family_def["SEARCH"] = parent
				self.PARSED["HOOKS"][parent] = hook_family_def
				self.queue_page_parse(self.parse_library, parent_href, hook_family_def)

			hook_def = {}
			hook_def["SEARCH"] = parent + ":" + member
			self.add_class_defs(hook_def, hook.classes)
			self.add_wiki_link(hook_def, hook, hook_def["SEARCH"])
			self.PARSED["HOOKS"][parent]["MEMBERS"][member] = hook_def

			self.queue_page_parse(self.parse_hook, hook.attrib["href"], hook_def)
		
		# Register enums
		for enum in CSSSelector("a.cm.enum")(self.TREE):
			enum_def = {}
			enum_def["LINK"] = enum.attrib["href"].removeprefix("/gmod/")
			enum_def["FAMILY"] = enum.attrib["search"]

			self.add_class_defs(enum_def, enum.classes, force_non_deprecated=True)
			self.queue_page_parse(self.parse_enum, enum.attrib["href"], enum_def)

		# Iterate through sidebar categories
		sel_category_name  = CSSSelector(":scope > summary > div")
		sel_category_list  = CSSSelector(":scope > ul > li > a")
		sel_category_items = CSSSelector(":scope > ul > li > details.level2")
		for category in CSSSelector("details.level1")(self.TREE):
			div = sel_category_name(category)[0]
			div.remove(div[1])
			name = div.text_content().strip()
			
			if name == "Globals":
				self.parse_globals("GLOBALS", sel_category_list(category))
			elif name == "Structs":
				self.parse_struct_category(sel_category_list(category))
			elif name == "Panels":
				self.parse_subcategory(category, self.PARSED["PANELS"], sel_category_items(category) + CSSSelector(":scope > ul > li > a.cm")(category))
			elif name == "Classes":
				self.parse_subcategory(category, self.PARSED["CLASSES"], sel_category_items(category))
			elif name == "Libraries":
				self.parse_subcategory(category, self.PARSED["LIBRARIES"], sel_category_items(category))
		
		# Process queue
		self.process_page_parse_queue()

		# Remove empty stuff
		def strip_empty_keys(member, id_base=""):
			for key in list(member):
				if len(key) == 0:
					print("Stripped \"" + id_base + key + "\" (empty key)")
					if ("LINK" in member[key]):
						print(WIKI_URL + "/gmod/" + member[key]["LINK"])
					del member[key]
				elif "members" in member[key]:
					strip_empty_keys(member[key]["members"], id_base + key + ".")
			
		for category, items in self.PARSED.items():
			strip_empty_keys(items)

def scrape(cached = False):
	return WikiParser(cached).PARSED