// Made by Spar, adapted code from LLLua
var bcnames2_1 = "ISLT  ISGE  ISLE  ISGT  ISEQV ISNEV ISEQS ISNES ISEQN ISNEN ISEQP ISNEP ISTC  ISFC  IST   ISF   ISTYPEISNUM MOV   NOT   UNM   LEN   ADDVN SUBVN MULVN DIVVN MODVN ADDNV SUBNV MULNV DIVNV MODNV ADDVV SUBVV MULVV DIVVV MODVV POW   CAT   KSTR  KCDATAKSHORTKNUM  KPRI  KNIL  UGET  USETV USETS USETN USETP UCLO  FNEW  TNEW  TDUP  GGET  GSET  TGETV TGETS TGETB TGETR TSETV TSETS TSETB TSETM TSETR CALLM CALL  CALLMTCALLT ITERC ITERN VARG  ISNEXTRETM  RET   RET0  RET1  FORI  JFORI FORL  IFORL JFORL ITERL IITERLJITERLLOOP  ILOOP JLOOP JMP   FUNCF IFUNCFJFUNCFFUNCV IFUNCVJFUNCVFUNCC FUNCCW"
var bcnames2_0 = "ISLT  ISGE  ISLE  ISGT  ISEQV ISNEV ISEQS ISNES ISEQN ISNEN ISEQP ISNEP ISTC  ISFC  IST   ISF   MOV   NOT   UNM   LEN   ADDVN SUBVN MULVN DIVVN MODVN ADDNV SUBNV MULNV DIVNV MODNV ADDVV SUBVV MULVV DIVVV MODVV POW   CAT   KSTR  KCDATAKSHORTKNUM  KPRI  KNIL  UGET  USETV USETS USETN USETP UCLO  FNEW  TNEW  TDUP  GGET  GSET  TGETV TGETS TGETB TSETV TSETS TSETB TSETM CALLM CALL  CALLMTCALLT ITERC ITERN VARG  ISNEXTRETM  RET   RET0  RET1  FORI  JFORI FORL  IFORL JFORL ITERL IITERLJITERLLOOP  ILOOP JLOOP JMP   FUNCF IFUNCFJFUNCFFUNCV IFUNCVJFUNCVFUNCC FUNCCW"
// We use 2 versions of bytecodes because GMod might update LuaJIT version and since this is used with lua_shared the reading will broke, so we handle this carefully.

var opcodesWeight = Object.freeze({
	"ISLT": 1, // Arithmetic comparison opcodes
	"ISGE": 1,
	"ISLE": 1,
	"ISGT": 1,
	"ISEQV": 1,
	"ISNEV": 1,
	"ISEQS": 1,
	"ISNES": 1,
	"ISEQN": 1,
	"ISNEN": 1,
	"ISEQP": 1,
	"ISNEP": 1,
	"ISTC": 1, // Comparison opcodes
	"ISFC": 1,
	"IST": 1,
	"ISF": 1,
	"ISTYPE": 1, // Internal 2.1 opcodes, filled just in case
	"ISNUM": 1, // same
	"MOV": 0.3, // MOV is most common opcode, it should give much weight but sometimes you need to organize it properly
	"NOT": 1, // Unary opcodes
	"UNM": 1,
	"LEN": 2, // Lenght might get expensive on tables
	"ADDVN": 1, // Arithmetics with literal + var is fine
	"SUBVN": 1,
	"MULVN": 1,
	"DIVVN": 1,
	"MODVN": 3, // Modulo is a - math.floor(a / b) + b so we will count as 3 opcodes
	"ADDNV": 1,
	"SUBNV": 1,
	"MULNV": 1,
	"DIVNV": 1,
	"MODNV": 3, // Same modulo
	"ADDVV": 1.5, // Arithmetics with 2 vars will be considered little bit expensive 
	"SUBVV": 1.5,
	"MULVV": 1.5,
	"DIVVV": 1.5,
	"MODVV": 4.5, // Same modulo with 2 vars
	"POW": 2, // Power is expensive, we can't check if it's ^ 2, but still
	"CAT": 5, // Concatenation is not compiled on LuaJIT 2.0, several concatenations in the row will count as single, but separate concatenations will add big cost
	"KSTR": 1, // Literals are fine
	"KCDATA": 1,
	"KSHORT": 1,
	"KNUM": 1,
	"KPRI": 1,
	"KNIL": 1,
	"UGET": 3, // Getting upvalue. The complexity is unkown because we don't know how far is the original local is, so we count as getting 3 locals.
	"USETV": 3.5, // Little expensive for the cost of getting value from the stack
	"USETS": 3, // These are fine
	"USETN": 3,
	"USETP": 3,
	"UCLO": 0, // TODO: to test if it should cost anything because you can't have UCLO without FNEW
	"FNEW": 10, // Functions are expensive
	"TNEW": 8, // New table with preallocated space, it costs more than TDUP because we failed to template the content (non-literal values in the constructor), also to punish people for defining empty table with filling it later 
	"TDUP": 6, // Table from template TODO: adjust the cost tbd
	"GGET": 4, // Indexing global table, costy than upvalue
	"GSET": 5, // Additional 1 for the possible cost of resizing 
	"TGETV": 2.5, // Indexing using a local variable? Take the cost
	"TGETS": 2, // That's a common opcode, it's fine
	"TGETB": 1.5, // Even more fine
	"TGETR": 1.5, // Internal LuaJIT 2.1 opcode, == TGETB
	"TSETV": 3.5, // Same as getters + 1 for possible cost of resizing
	"TSETS": 3,
	"TSETB": 2.5,
	"TSETM": 2.5, // VARARG will cost more, this opcode is fine, == TSETB because it resizes once
	"TSETR": 2.5, // Internal LuaJIT 2.1 opcode, == TSETB
	"CALLM": 5, // VARARG will add the cost, == CALL
	"CALL": 5,
	"CALLMT": 5, // VARARG will add the cost, == CALLT
	"CALLT": 5,
	"ITERC": 2, // generic for statement is fine
	"ITERN": 2, // ISNEXT already killing us, ITERN can't be without ISNEXT
	"VARG": 0,
	"ISNEXT": 5, // Checks for next, potential JIT kill
	"RETM": 1, // Costs little bit
	"RET": 1,
	"RET0": 0, // Costs nothing, MOV will account if necessary
	"RET1": 0,
	"FORI": 1, // Numeric for statement, additional cost is taken for initializing initial value, end and step by other opcodes above
	"FORL": 0, // Costs nothing because it ends the loop
	"ITERL": 0, // Costs nothing because it ends the loop
	"LOOP": 1, // Generic loop, let's count as FORI just for initializing
	"JMP": 0, // TODO: Should we pay for it? this is the most common opcode that exists in any comparison condition and in generic loops
})

var BCDUMP = {
	"F_BE": 0x01,
	"F_STRIP": 0x02,
	"F_FFI": 0x04,
	"F_FR2": 0x08,
	"F_KNOWN": (0x08 * 2 - 1),
}

function ReadULEB(obj) {
	var v = obj.buf[obj.caret] // First byte
	obj.caret++

	if (v >= 0x80) { // If it higher than 0x80 we read next bytes
		var sh = 7
		v = v - 0x80
		do {
			var r = obj.buf[obj.caret]
			v = v + ((r & 0x7f) << sh)
			sh = sh + 7
			obj.caret++
		} while (r >= 0x80)
	}

	return v
}

function ReadOpcode(obj) { // This function doesn't read instructions, just the opcode
	obj.MoveCaret(4)

	return obj.buf[obj.caret]
}

function GetOpcodeName(version, op) { // Get opcode name depending on the version, .trim is required to lookup the opcode in opcodesWeight later on
	return (version == 1 ? bcnames2_0 : bcnames2_1).slice(op * 6, op * 6 + 6).trim()
}

function ReadDebugLine(obj, bytes, isle) { // Depending on bytes and isle we read the line number.
	var oldcaret = obj.caret
	if (bytes == 1) {
		obj.MoveCaret(1)
		return obj.buf[oldcaret]
	}
	else if (bytes == 2) {
		obj.MoveCaret(2)
		if (isle) {
			return obj.buf[oldcaret] + (obj.buf[oldcaret + 1] << 8)
		} else {
			return obj.buf[oldcaret + 1] + (obj.buf[oldcaret] << 8)
		}
	}
	else if (bytes == 4) {
		obj.MoveCaret(4)
		if (isle) {
			return obj.buf[oldcaret] + (obj.buf[oldcaret + 1] << 8) + (obj.buf[oldcaret + 2] << (8 * 2)) + (obj.buf[oldcaret + 3] << (8 * 3))
		} else {
			return obj.buf[oldcaret + 3] + (obj.buf[oldcaret + 2] << 8) + (obj.buf[oldcaret + 1] << (8 * 2)) + (obj.buf[oldcaret] << (8 * 3))
		}
	}
}

class CChunk {
	constructor(buf) {
		this.buf = buf
		this.caret = 4
		this.protos = []
		this.flags = 0
		this.version = -1
		this.chunkname = ""
	}

	SetVersion(ver) {
		this.version = ver
	}

	SetFlags(flags) {
		this.flags = flags
	}

	SetName(name) {
		this.chunkname = name
	}

	MakeString(a, b) {
		return this.buf.slice(a, a + b).toString()
	}

	MoveCaret(v) {
		this.caret += v
	}

	IsStripped() {
		return this.flags & BCDUMP.F_STRIP
	}

	AddProto(proto) {
		this.protos.push(proto)
	}

}

class CProto {
	constructor(chunk, len) {
		this.caret = chunk.caret
		this.buf = chunk.buf
		this.len = len
		this.chunk = chunk
		this.lineinfo = ""
		this.sizebc = 0
		this.insts = []
		this.firstline = 0
		this.numline = 0
		this.flags = 0
	}

	SetLines(first, num) {
		this.firstline = first
		this.numline = num
	}

	MoveCaret(v) {
		this.caret += v
	}

	ReadProto() {
		this.caret += 4 // Skipping unused info

		ReadULEB(this) // Size of GCable objects
		ReadULEB(this) // Size of lua_Number objects
		var sizebc = ReadULEB(this) // Amount of instructions

		var sizedbg = 0 // Required at the end
		if (!this.chunk.IsStripped()) { // Read proto line information
			sizedbg = ReadULEB(this)

			if (sizedbg != 0) {
				this.SetLines(ReadULEB(this), ReadULEB(this)) // This is required to determine lines range
			}
		}

		for (var line = 0; line < sizebc; line++) { // Reading instructions
			var op = ReadOpcode(this) // TODO: Is it affected by endianness?
			this.insts.push([op]) // Array for line slot
		}

		if (sizedbg != 0) {
			this.caret = this.chunk.caret + this.len - sizedbg // Trick, reading from the end instead of beating complex reading after instructions
			var bytenum = this.numline < 256 ? 1 : ((this.numline < 65536) ? 2 : 4) // This deterines the required size of lines range. 
			var isle = (this.chunk.flags & BCDUMP.F_BE) == 0 // Is little endiann

			for (var line = 0; line < sizebc; line++) {
				this.insts[line][1] = ReadDebugLine(this, bytenum, isle) // Store in [1]
			}
		}
	}
}

function ReadChunk(bc) { // bc: Buffer
	if (bc[0] != 27 || bc[1] != 76 || bc[2] != 74) { // \27LJ signature
		throw Error("Bytecode signature mismatch. Is this LuaJIT bytecode?")
	}

	var version = bc[3]
	if (version == 0 || version > 2) { // Support only Lua 2.0 and 2.1
		throw Error("Unsupported bytecode version, only 1 and 2 are supported. Got " + version)
	}

	var Chunk = new CChunk(bc)
	Chunk.SetVersion(version) // Set the version

	Chunk.SetFlags(ReadULEB(Chunk)) // Read chunk flags

	if ((Chunk.flags & ~BCDUMP.F_KNOWN) != 0) { // Unknown flag
		throw Error("Unknown flag (" + flags.toString(16) + ")")
	}

	if (!Chunk.IsStripped()) { // Check if we have debug information
		var len = ReadULEB(Chunk)
		Chunk.SetName(Chunk.MakeString(Chunk.caret, len)) // Get chunkname
		Chunk.MoveCaret(len)
	}

	while (true) { // Read protos
		var protolen = ReadULEB(Chunk) // Proto length
		if (protolen == 0) { break } // Last byte in the chunk is \0 indicating END_OF_CHUNK
		var proto = new CProto(Chunk, protolen)
		proto.ReadProto(bc, Chunk.caret)
		Chunk.AddProto(proto)
		Chunk.MoveCaret(protolen) // Even if something fail in reading the proto chunk moves on
	}

	return Chunk
}

function MakeHeatMap(chunk) {
	let MaxWeight = 0;
	var LineHeatMap = [] // Return
	if (chunk.IsStripped()) {
		return [LineHeatMap, false]
	} // We can't make the heatmap
	var version = chunk.version

	for (var Proto of chunk.protos) { // Iterating protos
		for (var inst of Proto.insts) { // Each instructions
			var linenum = Proto.firstline + inst[1]
			if (!LineHeatMap[linenum]) { // if heatmap doesn't have the value, predefine it
				LineHeatMap[linenum] = [0, {}]
			}
			var opCode = GetOpcodeName(version,inst[0])
			if (!(opCode in opcodesWeight)) {
				console.warn("Unknown opcode: \"" + opCode + "\"")
			} else {
				var weight = opcodesWeight[opCode]
				
				if (!(opCode in LineHeatMap[linenum][1])) LineHeatMap[linenum][1][opCode] = 0; // Cumulative weight
				LineHeatMap[linenum][1][opCode] += weight

				LineHeatMap[linenum][0] += weight // Sum
				MaxWeight = Math.max(MaxWeight, LineHeatMap[linenum][0])
			}
		}
	}

	return [LineHeatMap, MaxWeight]
}

module.exports = {
	ReadChunk,
	MakeHeatMap,
	opcodesWeight
}