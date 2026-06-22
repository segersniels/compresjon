# Benchmarks

These numbers show the tradeoff CompreSJON is designed for: much smaller idle storage, with explicit CPU cost when freezing and thawing.

Run it yourself:

```sh
npm run benchmark
```

The benchmark uses a synthetic worker-cache shape with repeated account IDs, statuses, tags, flags, and payload text. That is intentionally close to the kind of JSON cache that tends to sit idle in long-running workers.

## Results

Environment:

- Node: `v24.14.0`
- Rows: `100,000`
- Runs per case: `5`
- Command: `npm run build && node scripts/benchmark.mjs && node --expose-gc scripts/benchmark.mjs`

### Runtime GC Only

This is the default Node experience. The odd `Memory delta` values are expected: Node cleans up unused memory on its own schedule, so one row can still include memory from earlier work while another row can look like `0.00 MiB` because cleanup happened at a convenient moment.

Read this table as "what memory can look like before cleanup catches up", not as exact retained memory for each compression level.

| Case              | Idle bytes | Memory delta |  Ratio vs JSON | Freeze ms | Read ms | Take ms | Process ms |
| ----------------- | ---------: | -----------: | -------------: | --------: | ------: | ------: | ---------: |
| Plain JSON string |  21.73 MiB |    60.50 MiB |          1.00x |      20.8 |    39.3 |     n/a |        n/a |
| Fast              |   1.78 MiB |    43.34 MiB | 12.19x smaller |     202.2 |    60.7 |    59.6 |      268.1 |
| Balanced          |   1.05 MiB |     0.00 MiB | 20.63x smaller |     239.5 |    50.6 |    57.3 |      297.1 |
| Dense             |   0.84 MiB |    40.36 MiB | 25.92x smaller |     305.4 |    49.4 |    55.0 |      359.8 |

### Explicit `globalThis.gc()`

This table asks Node to clean up before measuring. It is easier to compare, but it requires running Node with `--expose-gc`. CompreSJON's `gc: true` option uses the same exposed hook when it exists.

| Case              | Idle bytes | Memory delta |  Ratio vs JSON | Freeze ms | Read ms | Take ms | Process ms |
| ----------------- | ---------: | -----------: | -------------: | --------: | ------: | ------: | ---------: |
| Plain JSON string |  21.73 MiB |    21.52 MiB |          1.00x |      21.5 |    39.2 |     n/a |        n/a |
| Fast              |   1.78 MiB |     1.81 MiB | 12.19x smaller |     207.9 |    69.1 |    69.1 |      276.6 |
| Balanced          |   1.05 MiB |     1.05 MiB | 20.63x smaller |     245.3 |    58.0 |    58.4 |      304.9 |
| Dense             |   0.84 MiB |     0.84 MiB | 25.92x smaller |     308.9 |    57.0 |    57.2 |      366.6 |

## Reading This

- `Idle bytes` is the retained compressed payload size while the original live object is not referenced by your app.
- `Memory delta` is the whole-process memory change while the benchmark subject is retained.
- In the runtime-GC-only table, `Memory delta` is a rough signal. It can jump around because Node decides when to clean unused memory.
- In the explicit-`globalThis.gc()` table, `Memory delta` is measured after asking Node to clean up first.
- `Freeze ms` is construction from the live object into compressed cold storage.
- `Read ms` inflates without consuming compressed bytes, so it temporarily holds both compressed and live data.
- `Take ms` destructively inflates and clears CompreSJON's compressed reference before returning the live value.
- `Process ms` destructively inflates, mutates one item, and recompresses.

For regular usage, start with `Idle bytes` and `Ratio vs JSON`; those show the predictable cold-storage win. Then check `Freeze`, `Read`, `Take`, and `Process` to decide whether that memory win is worth the CPU cost for your worker. Use the runtime-GC-only `Memory delta` column as a reminder that memory may not drop immediately just because your code released an object.

## Takeaways

For this dataset, the default `Balanced` level keeps the idle payload around `20x` smaller than the JSON string representation. `Dense` saves more memory, but increases freeze/process time compared with `Balanced`. Freeze and process include CompreSJON's strict JSON validation so lossy values are rejected before compression.

CompreSJON does not make parsing free. It gives a worker a deliberate way to trade CPU for lower idle memory, and `take()` / `process()` avoid CompreSJON retaining a second compressed copy while the live value is in use.
