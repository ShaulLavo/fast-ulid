// fast-ulid — Fast ULID generator
// - Monotonic mode: lexicographically increasing even within the same millisecond
// - Non-monotonic mode (default): fresh random bytes every call, maximum throughput
// - `createUlid()` provides isolated state for Worker threads
// - Zero dependencies, works in Node, Bun, Deno, and browsers

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RANDOM_DIGITS = 16
const MAX_DIGIT = 31
const GET_RANDOM_VALUES_MAX_BYTES = 65_536
const BATCH = GET_RANDOM_VALUES_MAX_BYTES / RANDOM_DIGITS

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
		if (v === MAX_DIGIT) continue
		const next = v + 1
		s.lastRandom[i] = next
		s.out[10 + i] = ENC[next]
		// Clear carried digits only after finding room to increment.
		// An exhausted suffix must remain exhausted on every retry.
		for (let j = i + 1; j < RANDOM_DIGITS; j++) {
			s.lastRandom[j] = 0
			s.out[10 + j] = ENC[0]
		}
		return true
	}
	return false
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
			// A failed refill must not commit the new timestamp.
			monoSetRandom(s)
			writeTimestamp(s.out, ts)
			s.lastTimestamp = ts
			return s.dec.decode(s.out)
		}

		if (monoIncrement(s)) {
			return s.dec.decode(s.out)
		}

		throw new RangeError('ULID random component overflow')
	}
}

// ── Non-monotonic generator ─────────────────────────────────────────

// Pair lookup: 10-bit index (5+5 bits) → 2-char Crockford Base32 string.
// 1024 entries, built once at module load.
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
for (let i = 0; i < 32; i++) {
	DEC[ENCODING.charCodeAt(i)] = i
	// Also map lowercase letters (charCode | 0x20 gives lowercase)
	const lower = ENCODING.charCodeAt(i) | 0x20
	if (lower !== ENCODING.charCodeAt(i)) DEC[lower] = i
}

/**
 * Extract the UNIX-ms timestamp from a 26-character ULID string.
 * Accepts uppercase or lowercase. Validates the length and 48-bit timestamp
 * prefix, but does not validate the random suffix.
 */
export function timestamp(id: string): number {
	if (typeof id !== 'string' || id.length !== 26)
		throw new Error('Invalid ULID')

	const d0 = DEC[id.charCodeAt(0)] ?? 0xff
	const d1 = DEC[id.charCodeAt(1)] ?? 0xff
	const d2 = DEC[id.charCodeAt(2)] ?? 0xff
	const d3 = DEC[id.charCodeAt(3)] ?? 0xff
	const d4 = DEC[id.charCodeAt(4)] ?? 0xff
	const d5 = DEC[id.charCodeAt(5)] ?? 0xff
	const d6 = DEC[id.charCodeAt(6)] ?? 0xff
	const d7 = DEC[id.charCodeAt(7)] ?? 0xff
	const d8 = DEC[id.charCodeAt(8)] ?? 0xff
	const d9 = DEC[id.charCodeAt(9)] ?? 0xff

	if (d0 > 7 || (d0 | d1 | d2 | d3 | d4 | d5 | d6 | d7 | d8 | d9) === 0xff)
		throw new Error('Invalid ULID')

	return (
		d0 * 35184372088832 + // 2^45
		d1 * 1099511627776 + // 2^40
		d2 * 34359738368 + // 2^35
		d3 * 1073741824 + // 2^30
		d4 * 33554432 + // 2^25
		d5 * 1048576 + // 2^20
		d6 * 32768 + // 2^15
		d7 * 1024 + // 2^10
		d8 * 32 + // 2^5
		d9 // 2^0
	)
}
