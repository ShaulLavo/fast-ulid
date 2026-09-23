# fast-ulid

Fast ULID generator for JavaScript. Zero dependencies.

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

Historical measurements on Apple M1, Bun 1.3.10 ([source](https://github.com/ShaulLavo/fast-ulid-bench)):

| Benchmark | fast-ulid | ulid | ulidx | crypto.randomUUID |
|---|---|---|---|---|
| Single ID (monotonic) | **57 ns** | 465 ns | 476 ns | 73 ns |
| Single ID (non-monotonic) | **47 ns** | 872 ns | 894 ns | — |
| Batch 1k (monotonic) | **84 µs** | 478 µs | 473 µs | 44 µs |
| Batch 1k (non-monotonic) | **68 µs** | 902 µs | 897 µs | 44 µs |
| Timestamp decode | **2.3 ns** | 284 ns | 306 ns | — |

These measurements predate the stricter timestamp validation and overflow fixes.
Rerun the benchmark before using these timings to compare this revision.

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

Create an isolated generator with its own state for an independent ordering stream.
Create it once and reuse it: each generator allocates a 64 KiB random pool.
The module also allocates two shared 64 KiB pools, one for each mode.
Workers already have separate module state; the factory is also useful for
isolating generators within one runtime.

Pass `{ monotonic: true }` for a monotonic generator.

Monotonic generators throw `RangeError('ULID random component overflow')` when
the random suffix is exhausted. They do not wait for the clock or wrap the suffix.
Further calls at the same or an earlier timestamp continue to throw; generation
resumes once the clock advances past the last emitted timestamp.
Random-source errors propagate without committing a new timestamp or emitting
an unseeded ID. These guarantees also apply to `ulid({ monotonic: true })`.

### `timestamp(id: string): number`

Extract the UNIX millisecond timestamp from a 26-character ULID string. Accepts
uppercase or lowercase. Throws `Error('Invalid ULID')` for non-string inputs, an
incorrect length, invalid timestamp characters, or a timestamp above `2 ** 48 - 1`.

This is a timestamp extractor, not a complete ULID validator: it validates the
length and first 10 characters, but does not validate the 16-character random suffix.

## What makes it fast

- **Batched `crypto.getRandomValues`** — one browser-safe call per 4,096 IDs instead of every call
- **Pair lookup table** — 1024-entry table maps 10 bits to a 2-char string, eliminates TextDecoder from non-monotonic path
- **Timestamp caching** — skips re-encoding when ms hasn't changed
- **Monotonic increment** — same-ms IDs bump a counter instead of regenerating randomness
- **Reused byte buffers**: no per-call byte-buffer allocation; returned strings are still allocated
- **Fully unrolled** — no loops in encode/decode, all arithmetic inlined

## Spec compliance

Implements the [ULID spec](https://github.com/ulid/spec). The test suites cover:

| Requirement | |
|---|---|
| 26-char Crockford Base32 string | ✅ |
| 48-bit ms timestamp (10 chars) | ✅ |
| 80-bit cryptographic randomness (16 chars) | ✅ |
| Monotonic: same-ms IDs increment by 1 | ✅ |
| Overflow throws without blocking or wrapping on retry | ✅ |
| Random-source failure and recovery | ✅ |
| Decoder rejects malformed or oversized timestamp prefixes | ✅ |
| Lexicographic sort = chronological sort | ✅ |
| Clock rollback resilience | ✅ |
| Encode/decode roundtrip | ✅ |

## Development checks

Install development dependencies with Bun, then run all checks (requires Node.js
and Bun):

```bash
bun install
npm run check
```

Individual checks:

```bash
npm run typecheck # Type-check source and Bun tests without emitting files
bun test          # Source-level Bun suite
npm run test:node # Build, then run Node regressions against the package exports
```

The Node suite imports `fast-ulid` through its package export map and covers
malformed timestamp inputs, entropy failures and retries, deterministic carries,
full overflow, clock rollback, and random-pool refill boundaries.

## Runtime support

ESM-only. Requires global Web Crypto (`crypto.getRandomValues`), `Date.now`,
`Uint8Array`, and `TextDecoder`:

- Node.js 20+ (with Web Crypto enabled)
- Bun
- Deno
- Modern browsers

## License

MIT
