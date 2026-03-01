# fast-ulid

Fastest spec-compliant ULID generator for JavaScript. Zero dependencies.

## Install

```bash
npm install fast-ulid
```

## Usage

```ts
import { ulid, createUlid, timestamp } from 'fast-ulid'

// Generate a ULID (non-monotonic, fastest)
const id = ulid()

// Monotonic ULID (same-ms IDs are lexicographically increasing)
const id2 = ulid({ monotonic: true })

// Extract the timestamp from any ULID
const ms = timestamp(id)

// Create an isolated generator (useful for Workers)
const generate = createUlid()                    // non-monotonic
const generateMono = createUlid({ monotonic: true }) // monotonic
```

## API

### `ulid(opts?): string`

Generate a ULID. Returns a 26-character Crockford Base32 string.

By default, generates a non-monotonic ULID (fresh random bytes each call). Pass `{ monotonic: true }` for same-millisecond lexicographic ordering.

### `createUlid(opts?): () => string`

Create an isolated generator with its own state. Use this when you need a dedicated generator per Worker thread to avoid contention.

Pass `{ monotonic: true }` for a monotonic generator.

### `timestamp(id: string): number`

Extract the UNIX millisecond timestamp from a ULID string. Accepts uppercase or lowercase. Throws on invalid characters.

## Benchmark

Apple M1, Bun 1.3.10 ([source](https://github.com/ShaulLavo/fast-ulid-bench)):

| Benchmark | fast-ulid | ulid | ulidx | crypto.randomUUID |
|---|---|---|---|---|
| Single ID (monotonic) | **57 ns** | 465 ns | 476 ns | 73 ns |
| Single ID (non-monotonic) | **47 ns** | 872 ns | 894 ns | — |
| Batch 1k (monotonic) | **84 µs** | 478 µs | 473 µs | 44 µs |
| Batch 1k (non-monotonic) | **68 µs** | 902 µs | 897 µs | 44 µs |
| Timestamp decode | **2.3 ns** | 284 ns | 306 ns | — |

## What makes it fast

- **Batched randomness** — `crypto.getRandomValues` called once per 8,192 IDs, not every call
- **Pre-computed lookup table** — Uint8Array maps digit → charCode, no string indexing
- **Pair lookup table** — 1024-entry table maps 10 bits → 2-char string, eliminates TextDecoder from non-monotonic path
- **Reused output buffer** — single `Uint8Array(26)` + `TextDecoder`, zero allocations in monotonic hot path
- **Timestamp caching** — non-monotonic path skips timestamp encoding when ms hasn't changed
- **Monotonic increment** — same-ms IDs bump a counter instead of regenerating randomness
- **Bit masking** — `& 31` instead of modulo
- **Unrolled loops** — timestamp encode/decode fully unrolled, no loop overhead

## Spec compliance

Fully compliant with the [ULID spec](https://github.com/ulid/spec). 45 tests verify:

| Requirement | |
|---|---|
| 26-char Crockford Base32 string | ✅ |
| 48-bit ms timestamp (10 chars) | ✅ |
| 80-bit cryptographic randomness (16 chars) | ✅ |
| Monotonic: same-ms IDs increment by 1 | ✅ |
| Overflow advances timestamp | ✅ |
| Lexicographic sort = chronological sort | ✅ |
| Clock rollback resilience | ✅ |
| 10,000+ unique IDs | ✅ |
| Encode/decode roundtrip | ✅ |
| Case-insensitive decoding | ✅ |
| Invalid input rejection | ✅ |

```bash
bun test
```

## Runtime support

Works everywhere with `crypto.getRandomValues`, `Date.now`, and `TextDecoder`:

- Node.js 16+
- Bun
- Deno
- Modern browsers

## License

MIT
