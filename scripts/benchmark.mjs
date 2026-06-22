import CompreSJON, { CompressionLevel } from "../dist/index.js";

const rows = Number(process.env.COMPRESJON_BENCH_ROWS ?? 100_000);
const runs = Number(process.env.COMPRESJON_BENCH_RUNS ?? 5);
const levels = [
  ["Fast", CompressionLevel.Fast],
  ["Balanced", CompressionLevel.Balanced],
  ["Dense", CompressionLevel.Dense],
];

const source = makeCache(rows);
const jsonString = JSON.stringify(source);
const jsonBytes = Buffer.byteLength(jsonString);

console.log(`# CompreSJON benchmark\n`);
console.log(`Rows: ${rows.toLocaleString("en-US")}`);
console.log(`Runs: ${runs}`);
console.log(`Node: ${process.version}`);
console.log(`Memory mode: ${memoryMode()}\n`);
if (!isGcExposed()) {
  console.log(
    "Memory delta is a rough signal in this mode; Node decides when to clean unused memory, so the number can jump around between cases.\n",
  );
}

console.log(
  "| Case | Idle bytes | Memory delta | Ratio vs JSON | Freeze ms | Read ms | Take ms | Process ms |",
);
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
console.log(
  `| Plain JSON string | ${formatBytes(jsonBytes)} | ${formatBytes(memoryDeltaBytes(() => JSON.stringify(makeCache(rows))))} | 1.00x | ${time(() => JSON.stringify(source))} | ${time(() => JSON.parse(jsonString))} | n/a | n/a |`,
);

for (const [name, compressionLevel] of levels) {
  const freeze = samples(() => new CompreSJON(source, { compressionLevel }));
  const compressed = new CompreSJON(source, { compressionLevel });
  const idleBytes = compressed.byteLength;
  const memoryDelta = memoryDeltaBytes(() => new CompreSJON(makeCache(rows), { compressionLevel }));
  const read = samples(() => compressed.read());
  const take = samplesWithSetup(
    () => new CompreSJON(source, { compressionLevel }),
    (cache) => cache.take(),
  );
  const process = samplesWithSetup(
    () => new CompreSJON(source, { compressionLevel }),
    (cache) => {
      cache.process((items) => {
        items[0].revision += 1;
      });
    },
  );

  console.log(
    `| ${name} | ${formatBytes(idleBytes)} | ${formatBytes(memoryDelta)} | ${(jsonBytes / idleBytes).toFixed(2)}x smaller | ${formatMs(median(freeze))} | ${formatMs(median(read))} | ${formatMs(median(take))} | ${formatMs(median(process))} |`,
  );
}

function samples(callback) {
  return Array.from({ length: runs }, () => Number(measure(callback)));
}

function samplesWithSetup(setup, callback) {
  return Array.from({ length: runs }, () => {
    const subject = setup();

    return Number(measure(() => callback(subject)));
  });
}

function time(callback) {
  return formatMs(median(samples(callback)));
}

function measure(callback) {
  collect();
  const start = process.hrtime.bigint();
  callback();
  const end = process.hrtime.bigint();
  collect();

  return end - start;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  return sorted[midpoint];
}

function formatMs(nanoseconds) {
  return `${(nanoseconds / 1_000_000).toFixed(1)}`;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function memoryDeltaBytes(factory) {
  collect();
  const before = memoryBytes();
  globalThis.__compresjonBenchmarkSubject = factory();
  collect();
  const after = memoryBytes();
  globalThis.__compresjonBenchmarkSubject = undefined;
  collect();

  return Math.max(after - before, 0);
}

function memoryBytes() {
  const memory = process.memoryUsage();

  return memory.heapUsed + memory.arrayBuffers;
}

function collect() {
  globalThis.gc?.();
}

function memoryMode() {
  return isGcExposed() ? "explicit globalThis.gc()" : "runtime GC only";
}

function isGcExposed() {
  return typeof globalThis.gc === "function";
}

function makeCache(size) {
  return Array.from({ length: size }, (_, index) => ({
    id: index,
    accountId: `account-${index % 500}`,
    status: ["idle", "pending", "running", "complete"][index % 4],
    score: index % 997,
    revision: index % 11,
    flags: {
      stale: index % 9 === 0,
      billable: index % 3 === 0,
      archived: false,
    },
    tags: [`team-${index % 20}`, `region-${index % 7}`, `bucket-${index % 50}`],
    payload: `repeatable worker payload chunk ${index % 100}`,
  }));
}
