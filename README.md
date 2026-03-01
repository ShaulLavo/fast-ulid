# fast-ulid

Fastest spec-compliant ULID generator for JavaScript. Zero dependencies, ~2KB gzipped.

> **ULID** = timestamp + randomness in a single 26-char, URL-safe, sortable string.
>
> ```
> 01ARZ3NDEKTSV4RRFFQ69G5FAV   ← ULID (sortable, no dashes, encodes time)
> 550e8400-e29b-41d4-a716-44…  ← UUID (random, dashes, no ordering)
> ```

## Install

```bash
npm install fast-ulid
```

## Benchmark

Apple M1, Bun 1.3.10 ([source](https://github.com/ShaulLavo/fast-ulid-bench)):

| Benchmark | fast-ulid | ulid | ulidx | crypto.randomUUID |
|---|---|---|---|---|
| Single ID (monotonic) | **57 ns** | 465 ns | 476 ns | 73 ns |
| Single ID (non-monotonic) | **47 ns** | 872 ns | 894 ns | — |
| Batch 1k (monotonic) | **84 µs** | 478 µs | 473 µs | 44 µs |
| Batch 1k (non-monotonic) | **68 µs** | 902 µs | 897 µs | 44 µs |
| Timestamp decode | **2.3 ns** | 284 ns | 306 ns | — |

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

Extract the UNIX millisecond timestamp from a ULID string. Accepts uppercase or lowercase.

## What makes it fast

- **Batched `crypto.getRandomValues`** — one call per 8,192 IDs instead of every call
- **Pair lookup table** — 1024-entry table maps 10 bits to a 2-char string, eliminates TextDecoder from non-monotonic path
- **Timestamp caching** — skips re-encoding when ms hasn't changed
- **Monotonic increment** — same-ms IDs bump a counter instead of regenerating randomness
- **Zero allocations** — reused buffers, no intermediate objects in the hot path
- **Fully unrolled** — no loops in encode/decode, all arithmetic inlined

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
| Encode/decode roundtrip | ✅ |

```bash
bun test
```

## Runtime support

Works everywhere with `crypto.getRandomValues` and `Date.now`:

- Node.js 16+
- Bun
- Deno
- Modern browsers

## License

MIT
