import { describe, it, expect } from 'bun:test'
import { ulid, createUlid, timestamp } from '../src'

describe('ulid (non-monotonic, default)', () => {
	it('returns a 26-character string', () => {
		const id = ulid()
		expect(typeof id).toBe('string')
		expect(id.length).toBe(26)
	})

	it('only contains Crockford Base32 characters', () => {
		const valid = /^[0-9A-HJKMNP-TV-Z]+$/
		for (let i = 0; i < 100; i++) {
			expect(ulid()).toMatch(valid)
		}
	})

	it('generates unique IDs (1000 IDs)', () => {
		const ids = new Set<string>()
		for (let i = 0; i < 1000; i++) {
			ids.add(ulid())
		}
		expect(ids.size).toBe(1000)
	})

	it('is time-sortable: later IDs sort after earlier ones', async () => {
		const id1 = ulid()
		await new Promise(r => setTimeout(r, 2))
		const id2 = ulid()
		expect(id2 > id1).toBe(true)
	})

	it('stays unique under high volume (8200 IDs)', () => {
		const count = 8200
		const ids = new Set<string>()
		for (let i = 0; i < count; i++) {
			ids.add(ulid())
		}
		expect(ids.size).toBe(count)
	})

	it('timestamp() extracts correct ms from a ULID', () => {
		const before = Date.now()
		const id = ulid()
		const after = Date.now()

		const ts = timestamp(id)
		expect(ts).toBeGreaterThanOrEqual(before)
		expect(ts).toBeLessThanOrEqual(after)
	})

	it('timestamp() roundtrips a known value', () => {
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

	it('first 10 chars encode timestamp, last 16 are random', () => {
		const ids: string[] = []
		for (let i = 0; i < 100; i++) {
			ids.push(ulid())
		}

		const byPrefix = new Map<string, string[]>()
		for (const id of ids) {
			const prefix = id.slice(0, 10)
			const group = byPrefix.get(prefix) ?? []
			group.push(id)
			byPrefix.set(prefix, group)
		}

		const hasCollision = [...byPrefix.values()].some(
			g => g.length > 1
		)
		expect(hasCollision).toBe(true)

		for (const group of byPrefix.values()) {
			if (group.length > 1) {
				const suffixes = group.map(id => id.slice(10))
				const uniqueSuffixes = new Set(suffixes)
				expect(uniqueSuffixes.size).toBe(suffixes.length)
			}
		}
	})
})

describe('ulid({ monotonic: true })', () => {
	it('returns a 26-character Crockford Base32 string', () => {
		const valid = /^[0-9A-HJKMNP-TV-Z]{26}$/
		for (let i = 0; i < 100; i++) {
			expect(ulid({ monotonic: true })).toMatch(valid)
		}
	})

	it('is monotonic within the same millisecond', () => {
		const generator = createUlid({ monotonic: true })
		const originalNow = Date.now
		Date.now = () => 1_700_000_000_000

		try {
			const ids: string[] = []
			for (let i = 0; i < 300; i++) {
				ids.push(generator())
			}

			for (let i = 1; i < ids.length; i++) {
				expect(ids[i] > ids[i - 1]).toBe(true)
			}
		} finally {
			Date.now = originalNow
		}
	})

	it('stays monotonic when system clock moves backwards', () => {
		const generator = createUlid({ monotonic: true })
		const originalNow = Date.now
		let now = 5_000
		Date.now = () => now

		try {
			const id1 = generator()
			now = 4_999
			const id2 = generator()
			now = 4_998
			const id3 = generator()

			expect(id2 > id1).toBe(true)
			expect(id3 > id2).toBe(true)
			expect(id1.slice(0, 10)).toBe(id2.slice(0, 10))
			expect(id2.slice(0, 10)).toBe(id3.slice(0, 10))
		} finally {
			Date.now = originalNow
		}
	})

	it('generates unique IDs (10,000)', () => {
		const ids = new Set<string>()
		for (let i = 0; i < 10_000; i++) {
			ids.add(ulid({ monotonic: true }))
		}
		expect(ids.size).toBe(10_000)
	})
})

describe('createUlid (non-monotonic, default)', () => {
	it('creates an isolated generator', () => {
		const gen = createUlid()
		const ids = new Set<string>()
		for (let i = 0; i < 1000; i++) {
			ids.add(gen())
		}
		expect(ids.size).toBe(1000)
	})

	it('stays unique across random pool refills (8200+ IDs)', () => {
		const gen = createUlid()
		const count = 8200
		const ids = new Set<string>()
		for (let i = 0; i < count; i++) {
			ids.add(gen())
		}
		expect(ids.size).toBe(count)
	})
})

describe('createUlid({ monotonic: true })', () => {
	it('creates an isolated monotonic generator', () => {
		const gen = createUlid({ monotonic: true })
		const originalNow = Date.now
		Date.now = () => 1_700_000_000_000

		try {
			const ids: string[] = []
			for (let i = 0; i < 100; i++) {
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
