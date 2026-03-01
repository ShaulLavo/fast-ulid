import { bench, group, run } from 'mitata'
import { ulid, createUlid, timestamp } from '../src'

const generator = createUlid()

group('ID generation', () => {
	bench('ulid (shared)', () => ulid())
	bench('ulid (dedicated)', () => generator())
	bench('crypto.randomUUID()', () => crypto.randomUUID())
})

group('batch 1000 IDs', () => {
	bench('ulid', () => {
		const gen = createUlid()
		for (let i = 0; i < 1000; i++) gen()
	})
	bench('crypto.randomUUID()', () => {
		for (let i = 0; i < 1000; i++) crypto.randomUUID()
	})
})

// Pre-generate IDs so the bench only measures decode speed
const sampleId = ulid()
const sampleIds = Array.from({ length: 1000 }, () => ulid())

let sink: number = 0

group('timestamp extraction', () => {
	bench('timestamp(ulid)', () => {
		sink = timestamp(sampleId)
	})
	bench('Date.now()', () => {
		sink = Date.now()
	})
})

group('batch 1000 timestamp()', () => {
	bench('timestamp()', () => {
		for (let i = 0; i < 1000; i++) timestamp(sampleIds[i])
	})
})

await run()
