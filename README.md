# fast-ulid

Fastest spec-compliant monotonic ULID generator for JavaScript. ~62ns per ID, zero dependencies.

## Install

```bash
npm install fast-ulid
```

## Usage

```ts
import { ulid, createUlid, timestamp } from 'fast-ulid'

// Generate a ULID
const id = ulid()
// → "01HYX3QGZK4P8RJ5N0VWMT6B2A"

// Extract the timestamp
const ms = timestamp(id)
// → 1700000000000

// Create an isolated generator (useful for Workers)
const generate = createUlid()
generate()
generate()
```

## API

### `ulid(): string`

Generate a ULID using the default shared generator. Returns a 26-character Crockford Base32 string.

### `createUlid(): () => string`

Create an isolated generator with its own monotonic state. Use this when you need a dedicated generator per Worker thread to avoid contention.

### `timestamp(id: string): number`

Extract the UNIX millisecond timestamp from a ULID string. Unrolled decode — ~5.8ns per call.

## Benchmark

Measured on Apple M1, Bun 1.3.10:

| Operation | fast-ulid | crypto.randomUUID() |
|---|---|---|
| Single ID | **62 ns** | 44 ns |
| Batch 1000 | **84 µs** | 43 µs |

`crypto.randomUUID()` is a native C++ call that formats 128 random bits. `fast-ulid` does more work — timestamp encoding, monotonic ordering, Crockford Base32 — and is still within 1.5x.

```bash
bun run bench
```

## What makes it fast

- **Batched randomness** — `crypto.getRandomValues` called once per 8,192 IDs, not every call
- **Pre-computed lookup table** — Uint8Array maps digit → charCode, no string indexing
- **Reused output buffer** — single `Uint8Array(26)` + `TextDecoder`, zero allocations in hot path
- **Monotonic increment** — same-ms IDs bump a counter instead of regenerating randomness
- **Bit masking** — `& 31` instead of modulo
- **Unrolled loops** — timestamp encode/decode fully unrolled, no loop overhead

## Spec compliance

Fully compliant with the [ULID spec](https://github.com/ulid/spec). 26 tests verify:

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
