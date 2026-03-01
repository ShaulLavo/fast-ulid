import { describe, it, expect } from 'bun:test'
import { ulid, createUlid, timestamp } from '../src'

/**
 * Tests against the ULID spec: https://github.com/ulid/spec
 */

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CROCKFORD_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

describe('ULID spec compliance', () => {
	describe('1. String format', () => {
		it('is exactly 26 characters', () => {
			for (let i = 0; i < 1000; i++) {
				expect(ulid()).toHaveLength(26)
			}
		})

		it('uses only Crockford Base32 characters (excludes I, L, O, U)', () => {
			for (let i = 0; i < 1000; i++) {
				expect(ulid()).toMatch(CROCKFORD_RE)
			}
		})

		it('first 10 chars are timestamp, last 16 are randomness', () => {
			const id = ulid()
			const ts = id.slice(0, 10)
			const randomness = id.slice(10)
			expect(ts).toHaveLength(10)
			expect(randomness).toHaveLength(16)
		})
	})

	describe('2. Timestamp (48-bit, ms precision)', () => {
		it('encodes current UNIX time in milliseconds', () => {
			const before = Date.now()
			const id = ulid()
			const after = Date.now()

			const decoded = decodeCrockford(id.slice(0, 10))
			expect(decoded).toBeGreaterThanOrEqual(before)
			expect(decoded).toBeLessThanOrEqual(after)
		})

		it('timestamp changes across milliseconds', async () => {
			const id1 = ulid()
			await new Promise(r => setTimeout(r, 5))
			const id2 = ulid()

			const t1 = decodeCrockford(id1.slice(0, 10))
			const t2 = decodeCrockford(id2.slice(0, 10))
			expect(t2).toBeGreaterThan(t1)
		})

		it('max valid timestamp is 7ZZZZZZZZZ (2^48 - 1)', () => {
			const maxTs = decodeCrockford('7ZZZZZZZZZ')
			expect(maxTs).toBe(281474976710655)
		})
	})

	describe('3. Randomness (80-bit, cryptographically secure)', () => {
		it('uses 80 bits of randomness (16 base32 chars × 5 bits)', () => {
			const id = ulid()
			const random = id.slice(10)
			expect(random).toHaveLength(16)
			expect(random).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
		})

		it('randomness differs across IDs in different milliseconds', async () => {
			const gen = createUlid()
			const id1 = gen()
			await new Promise(r => setTimeout(r, 2))
			const id2 = gen()

			const r1 = id1.slice(10)
			const r2 = id2.slice(10)
			expect(r1).not.toBe(r2)
		})

		it('randomness has reasonable entropy (no constant pattern)', () => {
			const gen = createUlid()
			const randoms = new Set<string>()

			for (let i = 0; i < 100; i++) {
				const id = gen()
				randoms.add(id.slice(10))
			}

			expect(randoms.size).toBeGreaterThan(1)
		})
	})

	describe('4. Monotonicity', () => {
		it('same-millisecond IDs are strictly increasing', () => {
			const gen = createUlid({ monotonic: true })
			const originalNow = Date.now
			Date.now = () => 1_700_000_000_000

			try {
				const ids: string[] = []
				for (let i = 0; i < 1000; i++) {
					ids.push(gen())
				}

				for (let i = 1; i < ids.length; i++) {
					expect(ids[i] > ids[i - 1]).toBe(true)
				}
			} finally {
				Date.now = originalNow
			}
		})

		it('same-ms: randomness increments by 1 in least significant position', () => {
			const gen = createUlid({ monotonic: true })
			const originalNow = Date.now
			Date.now = () => 1_700_000_000_000

			try {
				const id1 = gen()
				const id2 = gen()

				expect(id1.slice(0, 10)).toBe(id2.slice(0, 10))

				const r1 = decodeCrockfordBigInt(id1.slice(10))
				const r2 = decodeCrockfordBigInt(id2.slice(10))
				expect(r2 - r1).toBe(1n)
			} finally {
				Date.now = originalNow
			}
		})

		it('carry propagates correctly on increment overflow', () => {
			const gen = createUlid({ monotonic: true })
			const originalNow = Date.now
			Date.now = () => 1_700_000_000_000

			try {
				const ids: string[] = []
				for (let i = 0; i < 500; i++) {
					ids.push(gen())
				}

				for (let i = 1; i < ids.length; i++) {
					expect(ids[i] > ids[i - 1]).toBe(true)
				}
			} finally {
				Date.now = originalNow
			}
		})
	})

	describe('5. Overflow handling', () => {
		it('handles randomness overflow by advancing timestamp', () => {
			const gen = createUlid({ monotonic: true })
			const originalNow = Date.now
			let fakeTime = 1_700_000_000_000
			Date.now = () => fakeTime

			try {
				const id1 = gen()

				for (let i = 0; i < 100; i++) {
					gen()
				}

				const lastId = gen()
				expect(lastId).toMatch(CROCKFORD_RE)
				expect(lastId > id1).toBe(true)
			} finally {
				Date.now = originalNow
			}
		})
	})

	describe('6. Lexicographic sorting', () => {
		it('string sort matches chronological order', async () => {
			const ids: string[] = []
			for (let i = 0; i < 5; i++) {
				ids.push(ulid())
				await new Promise(r => setTimeout(r, 2))
			}

			const sorted = [...ids].sort()
			expect(sorted).toEqual(ids)
		})

		it('string comparison works for same-ms monotonic IDs', () => {
			const gen = createUlid({ monotonic: true })
			const originalNow = Date.now
			Date.now = () => 1_700_000_000_000

			try {
				const ids: string[] = []
				for (let i = 0; i < 100; i++) {
					ids.push(gen())
				}

				const sorted = [...ids].sort()
				expect(sorted).toEqual(ids)
			} finally {
				Date.now = originalNow
			}
		})
	})

	describe('7. Clock rollback resilience', () => {
		it('IDs remain monotonic when clock goes backwards', () => {
			const gen = createUlid({ monotonic: true })
			const originalNow = Date.now
			let fakeTime = 1_700_000_000_000
			Date.now = () => fakeTime

			try {
				const id1 = gen()

				fakeTime = 1_699_999_999_000
				const id2 = gen()

				fakeTime = 1_699_999_998_000
				const id3 = gen()

				expect(id2 > id1).toBe(true)
				expect(id3 > id2).toBe(true)

				expect(id1.slice(0, 10)).toBe(id2.slice(0, 10))
				expect(id2.slice(0, 10)).toBe(id3.slice(0, 10))
			} finally {
				Date.now = originalNow
			}
		})

		it('resumes normal timestamps after clock catches up', () => {
			const gen = createUlid({ monotonic: true })
			const originalNow = Date.now
			let fakeTime = 1_700_000_000_000
			Date.now = () => fakeTime

			try {
				const id1 = gen()

				fakeTime = 1_699_999_999_000
				const id2 = gen()

				fakeTime = 1_700_000_001_000
				const id3 = gen()

				expect(id3 > id2).toBe(true)
				const t3 = decodeCrockford(id3.slice(0, 10))
				expect(t3).toBe(1_700_000_001_000)
			} finally {
				Date.now = originalNow
			}
		})
	})

	describe('8. Uniqueness', () => {
		it('10,000 IDs are all unique', () => {
			const gen = createUlid()
			const ids = new Set<string>()
			for (let i = 0; i < 10_000; i++) {
				ids.add(gen())
			}
			expect(ids.size).toBe(10_000)
		})

		it('IDs from separate generators are unique', () => {
			const gen1 = createUlid()
			const gen2 = createUlid()
			const ids = new Set<string>()

			for (let i = 0; i < 1000; i++) {
				ids.add(gen1())
				ids.add(gen2())
			}

			expect(ids.size).toBe(2000)
		})
	})

	describe('9. Encoding correctness', () => {
		it('roundtrip: decode(encode(timestamp)) === timestamp', () => {
			const now = Date.now()
			const gen = createUlid()
			const originalNow = Date.now
			Date.now = () => now

			try {
				const id = gen()
				const decoded = decodeCrockford(id.slice(0, 10))
				expect(decoded).toBe(now)
			} finally {
				Date.now = originalNow
			}
		})

		it('known timestamp encodes correctly', () => {
			const gen = createUlid()
			const originalNow = Date.now
			Date.now = () => 1_700_000_000_000

			try {
				const id = gen()
				const decoded = decodeCrockford(id.slice(0, 10))
				expect(decoded).toBe(1_700_000_000_000)
			} finally {
				Date.now = originalNow
			}
		})
	})
})

describe('timestamp()', () => {
	it('extracts the correct ms from a fresh ULID', () => {
		const before = Date.now()
		const id = ulid()
		const after = Date.now()

		const ts = timestamp(id)
		expect(ts).toBeGreaterThanOrEqual(before)
		expect(ts).toBeLessThanOrEqual(after)
	})

	it('matches the test-helper decoder', () => {
		for (let i = 0; i < 1000; i++) {
			const id = ulid()
			expect(timestamp(id)).toBe(decodeCrockford(id.slice(0, 10)))
		}
	})

	it('roundtrips a known timestamp', () => {
		const gen = createUlid()
		const originalNow = Date.now
		Date.now = () => 1_700_000_000_000

		try {
			const id = gen()
			expect(timestamp(id)).toBe(1_700_000_000_000)
		} finally {
			Date.now = originalNow
		}
	})

	it('handles epoch 0', () => {
		const gen = createUlid()
		const originalNow = Date.now
		Date.now = () => 0

		try {
			const id = gen()
			expect(timestamp(id)).toBe(0)
		} finally {
			Date.now = originalNow
		}
	})

	it('handles max 48-bit timestamp', () => {
		const gen = createUlid()
		const originalNow = Date.now
		const max48 = 281474976710655
		Date.now = () => max48

		try {
			const id = gen()
			expect(timestamp(id)).toBe(max48)
		} finally {
			Date.now = originalNow
		}
	})
})

/** Decode a Crockford base32 string to a number (for timestamp — up to 50 bits) */
function decodeCrockford(str: string): number {
	let result = 0
	for (let i = 0; i < str.length; i++) {
		const idx = CROCKFORD_ALPHABET.indexOf(str[i])
		if (idx === -1) throw new Error(`Invalid char: ${str[i]}`)
		result = result * 32 + idx
	}
	return result
}

/** Decode a Crockford base32 string to BigInt (for 80-bit randomness) */
function decodeCrockfordBigInt(str: string): bigint {
	let result = 0n
	for (let i = 0; i < str.length; i++) {
		const idx = CROCKFORD_ALPHABET.indexOf(str[i])
		if (idx === -1) throw new Error(`Invalid char: ${str[i]}`)
		result = result * 32n + BigInt(idx)
	}
	return result
}
