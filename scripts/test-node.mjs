import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
// Resolve the published entry point, not the TypeScript source.
import { ulid, createUlid, timestamp } from 'fast-ulid'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const FORMAT = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/
const NOW = 1_700_000_000_000
const SEEDS_PER_POOL = 4096
const OVERFLOW = { name: 'RangeError', message: 'ULID random component overflow' }

function withEnvironment(now, fillRandom, run) {
	const savedNow = Date.now
	const savedCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
	Date.now = now
	if (fillRandom) {
		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: {
				getRandomValues(array) {
					assert.ok(array.byteLength <= 65_536)
					return fillRandom(array)
				}
			}
		})
	}
	try {
		return run()
	} finally {
		Date.now = savedNow
		if (savedCrypto) Object.defineProperty(globalThis, 'crypto', savedCrypto)
		else Reflect.deleteProperty(globalThis, 'crypto')
	}
}

function decodeReference(value) {
	let result = 0n
	for (const char of value.toUpperCase()) {
		const digit = ALPHABET.indexOf(char)
		assert.notEqual(digit, -1)
		result = result * 32n + BigInt(digit)
	}
	return result
}

// These tests replace globals synchronously and must not run concurrently.
describe('built package regressions', { concurrency: false }, () => {
	it('imports all public exports and generates IDs using native Web Crypto', () => {
		const before = Date.now()
		const ids = [ulid(), ulid({ monotonic: true }), createUlid()(), createUlid({ monotonic: true })()]
		const after = Date.now()
		for (const id of ids) {
			assert.match(id, FORMAT)
			assert.ok(timestamp(id) >= before && timestamp(id) <= after)
		}
	})

	it('rejects non-string inputs and every incorrect length around 26', () => {
		for (const value of [null, undefined, 0, {}, [], new String('0'.repeat(26))]) {
			assert.throws(() => timestamp(value), /Invalid ULID/)
		}
		for (let length = 0; length <= 30; length++) {
			if (length !== 26) assert.throws(() => timestamp('0'.repeat(length)), /Invalid ULID/)
		}
	})

	it('rejects invalid ASCII and non-ASCII characters in every timestamp position', () => {
		const invalid = ['!', 'I', 'L', 'O', 'U', 'i', 'l', 'o', 'u', '\0', '\x7f', '\x80', 'é', '中', '\ud800']
		for (let position = 0; position < 10; position++) {
			for (const char of invalid) {
				const id = '0'.repeat(position) + char + '0'.repeat(25 - position)
				assert.throws(() => timestamp(id), /Invalid ULID/)
			}
		}
	})

	it('rejects every first digit above the 48-bit limit, in either case', () => {
		for (const digit of ALPHABET.slice(8)) {
			assert.throws(() => timestamp(digit + '0'.repeat(25)), /Invalid ULID/)
			assert.throws(() => timestamp(digit.toLowerCase() + '0'.repeat(25)), /Invalid ULID/)
		}
		assert.equal(timestamp('7' + 'Z'.repeat(25)), 2 ** 48 - 1)
	})

	it('roundtrips timestamp bit boundaries in both modes and letter cases', () => {
		const values = [0, 1, 2 ** 48 - 1]
		for (let bit = 1; bit < 48; bit++) values.push(2 ** bit - 1, 2 ** bit, 2 ** bit + 1)
		for (const value of values) {
			withEnvironment(() => value, array => array.fill(1), () => {
				for (const monotonic of [false, true]) {
					const id = createUlid({ monotonic })()
					assert.match(id, FORMAT)
					assert.equal(Number(decodeReference(id.slice(0, 10))), value)
					assert.equal(timestamp(id), value)
					assert.equal(timestamp(id.toLowerCase()), value)
					assert.equal(timestamp(id.slice(0, 5).toLowerCase() + id.slice(5)), value)
				}
			})
		}
	})

	it('treats timestamp() as a prefix extractor, not a random-suffix validator', () => {
		assert.equal(timestamp('0000000000' + '!'.repeat(16)), 0)
	})

	for (const monotonic of [false, true]) {
		const mode = monotonic ? 'monotonic' : 'non-monotonic'
		it(`${mode}: retries initial entropy failures and recovers at the same timestamp`, () => {
			let calls = 0
			withEnvironment(() => NOW, array => {
				calls++
				array.fill(31) // Even a provider that partially writes before failing is safe.
				if (calls <= 2) throw new Error('Entropy unavailable')
				return array.fill(2)
			}, () => {
				const gen = createUlid({ monotonic })
				assert.throws(gen, /Entropy unavailable/)
				assert.throws(gen, /Entropy unavailable/)
				const id = gen()
				assert.equal(calls, 3)
				assert.match(id, FORMAT)
				assert.equal(timestamp(id), NOW)
				assert.equal(id.slice(10), '2'.repeat(16))
			})
		})

		it(`${mode}: retries a failed later refill instead of reusing the previous seed`, () => {
			let now = NOW
			let calls = 0
			withEnvironment(() => now, array => {
				calls++
				if (calls === 2 || calls === 3) {
					array.fill(31)
					throw new Error('Entropy unavailable')
				}
				return array.fill(calls)
			}, () => {
				const gen = createUlid({ monotonic })
				for (let i = 0; i < SEEDS_PER_POOL; i++) {
					assert.equal(gen().slice(10), '1'.repeat(16))
					now++
				}
				assert.throws(gen, /Entropy unavailable/)
				assert.throws(gen, /Entropy unavailable/)
				const id = gen()
				assert.equal(calls, 4)
				assert.match(id, FORMAT)
				assert.equal(timestamp(id), now)
				assert.equal(id.slice(10), '4'.repeat(16))
			})
		})

		it(`${mode}: refills exactly at the pool boundary within the Web Crypto limit`, () => {
			let now = NOW
			let calls = 0
			withEnvironment(() => now, array => {
				assert.equal(array.byteLength, 65_536)
				return array.fill(++calls)
			}, () => {
				const gen = createUlid({ monotonic })
				for (let i = 0; i < 8200; i++) {
					const expectedFill = Math.floor(i / SEEDS_PER_POOL) + 1
					const id = gen()
					assert.equal(calls, expectedFill)
					assert.equal(id.slice(10), String(expectedFill).repeat(16))
					assert.equal(timestamp(id), now)
					if (monotonic) now++
				}
				assert.equal(calls, 3)
			})
		})
	}

	it('does not emit unseeded IDs from separate generators after entropy failures', () => {
		let calls = 0
		withEnvironment(() => NOW, () => {
			calls++
			throw new Error('Entropy unavailable')
		}, () => {
			const first = createUlid({ monotonic: true })
			const second = createUlid({ monotonic: true })
			for (let i = 0; i < 3; i++) {
				assert.throws(first, /Entropy unavailable/)
				assert.throws(second, /Entropy unavailable/)
			}
			assert.equal(calls, 6)
		})
	})

	it('preserves the last committed monotonic state when a refill fails and the clock rolls back', () => {
		let now = NOW
		let calls = 0
		withEnvironment(() => now, array => {
			if (++calls > 1) {
				array.fill(31)
				throw new Error('Entropy unavailable')
			}
			return array.fill(1)
		}, () => {
			const gen = createUlid({ monotonic: true })
			let last
			for (let i = 0; i < SEEDS_PER_POOL; i++) {
				last = gen()
				now++
			}
			assert.throws(gen, /Entropy unavailable/)
			now = NOW
			const next = gen()
			assert.equal(timestamp(next), timestamp(last))
			assert.equal(decodeReference(next.slice(10)), decodeReference(last.slice(10)) + 1n)
			assert.ok(next > last)
		})
	})

	it('propagates carries of every length without changing the timestamp', () => {
		for (let carry = 0; carry < 16; carry++) {
			withEnvironment(() => NOW, array => {
				array.fill(0)
				array.fill(31, 16 - carry, 16)
				return array
			}, () => {
				const gen = createUlid({ monotonic: true })
				const first = gen()
				const second = gen()
				assert.equal(decodeReference(second.slice(10)), decodeReference(first.slice(10)) + 1n)
				assert.equal(timestamp(second), NOW)
				assert.ok(second > first)
			})
		}
	})

	it('throws on full overflow without polling, wrapping on retry, or losing rollback protection', () => {
		let now = NOW
		let reads = 0
		withEnvironment(() => {
			// Bound clock reads so the old busy-wait fails instead of hanging the test runner.
			if (++reads > 100) throw new Error('Unexpected clock polling')
			return now
		}, array => array.fill(31), () => {
			const gen = createUlid({ monotonic: true })
			const first = gen()
			assert.equal(first.slice(10), 'Z'.repeat(16))
			assert.throws(gen, OVERFLOW)
			assert.throws(gen, OVERFLOW)
			now--
			assert.throws(gen, OVERFLOW)
			now = NOW + 1
			const recovered = gen()
			assert.match(recovered, FORMAT)
			assert.ok(recovered > first)
			assert.equal(timestamp(recovered), now)
			assert.equal(reads, 5)
		})
	})

	it('does not wrap after overflow at the maximum valid timestamp', () => {
		let reads = 0
		withEnvironment(() => {
			if (++reads > 100) throw new Error('Unexpected clock polling')
			return 2 ** 48 - 1
		}, array => array.fill(31), () => {
			const gen = createUlid({ monotonic: true })
			assert.equal(gen(), '7' + 'Z'.repeat(25))
			assert.throws(gen, OVERFLOW)
			assert.throws(gen, OVERFLOW)
		})
	})

	it('keeps 10,000 monotonic increments ordered through clock rollback', () => {
		let now = NOW
		withEnvironment(() => now, array => array.fill(0), () => {
			const gen = createUlid({ monotonic: true })
			let previous = gen()
			for (let i = 0; i < 10_000; i++) {
				if (i === 5000) now--
				const id = gen()
				assert.match(id, FORMAT)
				assert.ok(id > previous)
				assert.equal(timestamp(id), NOW)
				previous = id
			}
			now = NOW + 1
			assert.ok(gen() > previous)
		})
	})

	it('generates 10,000 distinct non-monotonic IDs across real random-pool refills', () => {
		withEnvironment(() => NOW, null, () => {
			const gen = createUlid()
			const ids = new Set()
			for (let i = 0; i < 10_000; i++) {
				const id = gen()
				assert.match(id, FORMAT)
				assert.equal(timestamp(id), NOW)
				ids.add(id)
			}
			assert.equal(ids.size, 10_000)
		})
	})
})
