// fast-ulid — Fast ULID generator
// - Monotonic mode: lexicographically increasing even within the same millisecond
// - Non-monotonic mode (default): fresh random bytes every call, maximum throughput
// - `createUlid()` provides isolated state for Worker threads
// - Zero dependencies, works in Node, Bun, Deno, and browsers

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RANDOM_DIGITS = 16
const MAX_DIGIT = 31
const BATCH = 8192

const ENC = new Uint8Array(32)
for (let i = 0; i < 32; i++) ENC[i] = ENCODING.charCodeAt(i)

// ── Shared internal helpers ─────────────────────────────────────────

function writeTimestamp(out: Uint8Array, t: number): void {
	out[0] = ENC[Math.floor(t / 35184372088832) & MAX_DIGIT] // 2^45
	out[1] = ENC[Math.floor(t / 1099511627776) & MAX_DIGIT] // 2^40
	out[2] = ENC[Math.floor(t / 34359738368) & MAX_DIGIT] // 2^35
	out[3] = ENC[Math.floor(t / 1073741824) & MAX_DIGIT] // 2^30
	out[4] = ENC[Math.floor(t / 33554432) & MAX_DIGIT] // 2^25
	out[5] = ENC[Math.floor(t / 1048576) & MAX_DIGIT] // 2^20
	out[6] = ENC[Math.floor(t / 32768) & MAX_DIGIT] // 2^15
	out[7] = ENC[Math.floor(t / 1024) & MAX_DIGIT] // 2^10
	out[8] = ENC[Math.floor(t / 32) & MAX_DIGIT] // 2^5
	out[9] = ENC[t & MAX_DIGIT] // 2^0
}

// ── Monotonic generator ─────────────────────────────────────────────

interface MonoState {
	lastTimestamp: number
	lastRandom: Uint8Array
	pool: Uint8Array
	poolPos: number
	out: Uint8Array
	dec: TextDecoder
}

function monoSetRandom(s: MonoState): void {
	if (s.poolPos >= BATCH) {
		crypto.getRandomValues(s.pool)
		s.poolPos = 0
	}
	const off = s.poolPos * RANDOM_DIGITS
	s.poolPos += 1
	for (let i = 0; i < RANDOM_DIGITS; i++) {
		const d = s.pool[off + i] & MAX_DIGIT
		s.lastRandom[i] = d
		s.out[10 + i] = ENC[d]
	}
}

function monoIncrement(s: MonoState): boolean {
	for (let i = RANDOM_DIGITS - 1; i >= 0; i--) {
		const v = s.lastRandom[i]
		if (v < MAX_DIGIT) {
			const next = v + 1
			s.lastRandom[i] = next
			s.out[10 + i] = ENC[next]
			return true
		}
		s.lastRandom[i] = 0
		s.out[10 + i] = ENC[0]
	}
	return false
}

function monoNextTs(prev: number): number {
	let t = Date.now()
	while (t <= prev) t = Date.now()
	return t
}

function createMonotonic(): () => string {
	const s: MonoState = {
		lastTimestamp: -1,
		lastRandom: new Uint8Array(RANDOM_DIGITS),
		pool: new Uint8Array(BATCH * RANDOM_DIGITS),
		poolPos: BATCH,
		out: new Uint8Array(26),
		dec: new TextDecoder()
	}

	return function monotonic(): string {
		const now = Date.now()
		const ts = now > s.lastTimestamp ? now : s.lastTimestamp

		if (ts > s.lastTimestamp) {
			s.lastTimestamp = ts
			writeTimestamp(s.out, ts)
			monoSetRandom(s)
			return s.dec.decode(s.out)
		}

		if (monoIncrement(s)) {
			return s.dec.decode(s.out)
		}

		s.lastTimestamp = monoNextTs(s.lastTimestamp)
		writeTimestamp(s.out, s.lastTimestamp)
		monoSetRandom(s)
		return s.dec.decode(s.out)
	}
}

// ── Non-monotonic generator ─────────────────────────────────────────

// Pair lookup: 10-bit index (5+5 bits) → 2-char Crockford Base32 string.
// 1024 entries, built once at module load. Eliminates TextDecoder entirely.
const PAIR = new Array<string>(1024)
for (let i = 0; i < 1024; i++)
	PAIR[i] = ENCODING[(i >> 5) & 31] + ENCODING[i & 31]

function encodeTimestampStr(t: number): string {
	return String.fromCharCode(
		ENC[Math.floor(t / 35184372088832) & MAX_DIGIT],
		ENC[Math.floor(t / 1099511627776) & MAX_DIGIT],
		ENC[Math.floor(t / 34359738368) & MAX_DIGIT],
		ENC[Math.floor(t / 1073741824) & MAX_DIGIT],
		ENC[Math.floor(t / 33554432) & MAX_DIGIT],
		ENC[Math.floor(t / 1048576) & MAX_DIGIT],
		ENC[Math.floor(t / 32768) & MAX_DIGIT],
		ENC[Math.floor(t / 1024) & MAX_DIGIT],
		ENC[Math.floor(t / 32) & MAX_DIGIT],
		ENC[t & MAX_DIGIT]
	)
}

function createNonMonotonic(): () => string {
	const pool = new Uint8Array(BATCH * RANDOM_DIGITS)
	let poolPos = BATCH
	let lastT = -1
	let tsStr = ''

	return function nonMonotonic(): string {
		if (poolPos >= BATCH) {
			crypto.getRandomValues(pool)
			poolPos = 0
		}

		const t = Date.now()
		if (t !== lastT) {
			lastT = t
			tsStr = encodeTimestampStr(t)
		}

		const b = poolPos * RANDOM_DIGITS
		poolPos += 1

		return tsStr
			+ PAIR[((pool[b] & MAX_DIGIT) << 5) | (pool[b + 1] & MAX_DIGIT)]
			+ PAIR[((pool[b + 2] & MAX_DIGIT) << 5) | (pool[b + 3] & MAX_DIGIT)]
			+ PAIR[((pool[b + 4] & MAX_DIGIT) << 5) | (pool[b + 5] & MAX_DIGIT)]
			+ PAIR[((pool[b + 6] & MAX_DIGIT) << 5) | (pool[b + 7] & MAX_DIGIT)]
			+ PAIR[((pool[b + 8] & MAX_DIGIT) << 5) | (pool[b + 9] & MAX_DIGIT)]
			+ PAIR[((pool[b + 10] & MAX_DIGIT) << 5) | (pool[b + 11] & MAX_DIGIT)]
			+ PAIR[((pool[b + 12] & MAX_DIGIT) << 5) | (pool[b + 13] & MAX_DIGIT)]
			+ PAIR[((pool[b + 14] & MAX_DIGIT) << 5) | (pool[b + 15] & MAX_DIGIT)]
	}
}

// ── Public API ──────────────────────────────────────────────────────

export interface UlidOptions {
	monotonic?: boolean
}

/** Create an isolated ULID generator. Non-monotonic by default. */
export function createUlid(opts?: UlidOptions): () => string {
	return opts?.monotonic ? createMonotonic() : createNonMonotonic()
}

const _shared = createNonMonotonic()
const _sharedMono = createMonotonic()

/** Generate a ULID. Non-monotonic by default. Pass `{ monotonic: true }` for same-ms ordering. */
export function ulid(opts?: UlidOptions): string {
	return opts?.monotonic ? _sharedMono() : _shared()
}

// ── Timestamp decoder ───────────────────────────────────────────────

const DEC = new Uint8Array(128).fill(0xff)
for (let i = 0; i < 32; i++) DEC[ENCODING.charCodeAt(i)] = i

/** Extract the UNIX-ms timestamp from a ULID string. */
export function timestamp(id: string): number {
	return (
		DEC[id.charCodeAt(0)] * 35184372088832 + // 2^45
		DEC[id.charCodeAt(1)] * 1099511627776 + // 2^40
		DEC[id.charCodeAt(2)] * 34359738368 + // 2^35
		DEC[id.charCodeAt(3)] * 1073741824 + // 2^30
		DEC[id.charCodeAt(4)] * 33554432 + // 2^25
		DEC[id.charCodeAt(5)] * 1048576 + // 2^20
		DEC[id.charCodeAt(6)] * 32768 + // 2^15
		DEC[id.charCodeAt(7)] * 1024 + // 2^10
		DEC[id.charCodeAt(8)] * 32 + // 2^5
		DEC[id.charCodeAt(9)] // 2^0
	)
}
