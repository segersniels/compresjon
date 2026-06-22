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
- Command: `npm run build && node --expose-gc scripts/benchmark.mjs`

| Case              | Idle bytes |  Ratio vs JSON | Freeze ms | Read ms | Take ms | Process ms |
| ----------------- | ---------: | -------------: | --------: | ------: | ------: | ---------: |
| Plain JSON string |  21.73 MiB |          1.00x |      21.1 |    37.8 |     n/a |        n/a |
| Fast              |   1.78 MiB | 12.19x smaller |      43.2 |    69.8 |    69.8 |      113.6 |
| Balanced          |   1.05 MiB | 20.63x smaller |      84.7 |    56.3 |    58.6 |      138.4 |
| Dense             |   0.84 MiB | 25.92x smaller |     143.6 |    55.8 |    57.4 |      200.4 |

## Reading This

- `Idle bytes` is the retained compressed payload size while the original live object is not referenced by your app.
- `Freeze ms` is construction from the live object into compressed cold storage.
- `Read ms` inflates without consuming compressed bytes, so it temporarily holds both compressed and live data.
- `Take ms` destructively inflates and clears CompreSJON's compressed reference before returning the live value.
- `Process ms` destructively inflates, mutates one item, and recompresses.

## Takeaways

For this dataset, the default `Balanced` level keeps the idle payload around `20x` smaller than the JSON string representation. `Dense` saves more memory, but increases freeze/process time compared with `Balanced`.

CompreSJON does not make parsing free. It gives a worker a deliberate way to trade CPU for lower idle memory, and `take()` / `process()` avoid CompreSJON retaining a second compressed copy while the live value is in use.
