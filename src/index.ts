import {
  brotliCompress,
  brotliCompressSync,
  brotliDecompress,
  brotliDecompressSync,
  constants,
} from "node:zlib";
import { Buffer } from "node:buffer";
import { inspect, promisify } from "node:util";

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);
const FORMAT = "compresjon/brotli-json/v1";
const EMPTY_BUFFER = Buffer.alloc(0);

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type GarbageCollectionPhase = "take" | "update" | "dispose";
export type GarbageCollector = (phase: GarbageCollectionPhase) => void;

export enum CompressionLevel {
  Fast = 1,
  Balanced = 5,
  Dense = 8,
  Maximum = 11,
  Lowest = Fast,
  Default = Balanced,
  Highest = Maximum,
}

export interface CompreSJONOptions {
  /**
   * Brotli quality from 0 to 11. Higher values can be dramatically slower.
   */
  compressionLevel?: CompressionLevel | number;
  /**
   * Explicit GC hook for memory-sensitive workers.
   *
   * `true` opts in to calling `globalThis.gc()` when the runtime exposes it.
   * Missing `globalThis.gc()` is a no-op.
   * A function can be used for custom scheduling, metrics, or tests.
   */
  gc?: boolean | GarbageCollector;
}

export interface BufferOptions {
  /**
   * Return a defensive copy of the compressed bytes.
   *
   * Disable this only when the caller owns the returned buffer and will not mutate it.
   */
  copy?: boolean;
}

export interface CompreSJONEnvelope {
  format: typeof FORMAT;
  data: string;
  compressionLevel?: number;
  jsonBytes?: number;
}

export type CompreSJONJSON = CompreSJONEnvelope;

export interface CompreSJONStats {
  compressedBytes: number;
  compressionLevel: number;
  isEmpty: boolean;
  jsonBytes?: number;
  ratio?: number;
  savingsBytes?: number;
  savingsPercent?: number;
}

export class EmptyBufferError extends Error {
  constructor() {
    super("The compressed data has already been consumed. Call update() before reading it again.");
    this.name = "EmptyBufferError";
  }
}

export class InvalidPayloadError extends Error {
  constructor() {
    super("Expected a valid CompreSJON transport payload.");
    this.name = "InvalidPayloadError";
  }
}

export class InvalidJsonValueError extends Error {
  constructor(cause?: unknown) {
    super("Expected a JSON-serializable value.", { cause });
    this.name = "InvalidJsonValueError";
  }
}

export class InvalidCompressedDataError extends Error {
  constructor(cause?: unknown) {
    super("Expected Brotli-compressed JSON data.", { cause });
    this.name = "InvalidCompressedDataError";
  }
}

export class AsyncProcessCallbackError extends Error {
  constructor() {
    super("process() callbacks must be synchronous. Use processAsync() for async work.");
    this.name = "AsyncProcessCallbackError";
  }
}

/**
 * Cold storage for large JSON-compatible values.
 *
 * Keep application data in this compressed wrapper while it is idle, then use
 * `take()` for destructive reads or `process()` for guarded mutate-and-
 * recompress workflows.
 */
export default class CompreSJON<T = JsonValue> {
  #compressed: Buffer = EMPTY_BUFFER;
  #jsonBytes?: number;
  #compressionLevel: number;
  #garbageCollector?: GarbageCollector;

  constructor(input: T | Uint8Array, options: CompreSJONOptions = {}) {
    this.#compressionLevel = normalizeCompressionLevel(options.compressionLevel);
    this.#garbageCollector = resolveGarbageCollector(options.gc);

    if (isByteLike(input)) {
      this.#compressed = Buffer.from(input);

      return;
    }

    this.setPayload(encodeSync(input, this.#compressionLevel));
  }

  public static from<T>(input: T, options?: CompreSJONOptions): CompreSJON<T> {
    return new CompreSJON(input, options);
  }

  public static async fromAsync<T>(
    input: T,
    options: CompreSJONOptions = {},
  ): Promise<CompreSJON<T>> {
    const instance = new CompreSJON<T>(Buffer.alloc(0), options);
    await instance.updateAsync(input);

    return instance;
  }

  public static fromBuffer<T>(input: Uint8Array, options?: CompreSJONOptions): CompreSJON<T> {
    return new CompreSJON<T>(input, options);
  }

  public static fromBase64<T>(input: string, options?: CompreSJONOptions): CompreSJON<T> {
    if (!isBase64(input)) {
      throw new InvalidPayloadError();
    }

    return CompreSJON.fromBuffer<T>(Buffer.from(input, "base64"), options);
  }

  public static fromJSON<T>(
    payload: CompreSJONEnvelope,
    options?: CompreSJONOptions,
  ): CompreSJON<T> {
    validatePayload(payload);

    const instance = new CompreSJON<T>(Buffer.from(payload.data, "base64"), {
      ...options,
      compressionLevel: options?.compressionLevel ?? payload.compressionLevel,
    });

    instance.#jsonBytes = payload.jsonBytes;

    return instance;
  }

  public static fromEnvelope<T>(
    payload: CompreSJONEnvelope,
    options?: CompreSJONOptions,
  ): CompreSJON<T> {
    return CompreSJON.fromJSON<T>(payload, options);
  }

  public get byteLength(): number {
    return this.#compressed.length;
  }

  public get isEmpty(): boolean {
    return this.#compressed.length === 0;
  }

  public get stats(): CompreSJONStats {
    const compressedBytes = this.#compressed.length;
    const savingsBytes =
      this.#jsonBytes === undefined || compressedBytes === 0
        ? undefined
        : this.#jsonBytes - compressedBytes;
    const ratio =
      this.#jsonBytes === undefined || compressedBytes === 0
        ? undefined
        : this.#jsonBytes / compressedBytes;
    const savingsPercent =
      this.#jsonBytes === undefined || savingsBytes === undefined
        ? undefined
        : savingsBytes / this.#jsonBytes;

    return {
      compressedBytes,
      compressionLevel: this.#compressionLevel,
      isEmpty: compressedBytes === 0,
      jsonBytes: this.#jsonBytes,
      ratio,
      savingsBytes,
      savingsPercent,
    };
  }

  /**
   * @deprecated Use `toBuffer()` instead. This returns a defensive copy.
   */
  public get buffer(): Buffer {
    return this.#compressed.length === 0 ? EMPTY_BUFFER : Buffer.from(this.#compressed);
  }

  public set buffer(input: Buffer) {
    this.setPayload({ compressed: Buffer.from(input) });
  }

  public update(input: T): void {
    this.setPayload(encodeSync(input, this.#compressionLevel));
    this.collectGarbage("update");
  }

  public async updateAsync(input: T): Promise<void> {
    this.setPayload(await encodeAsync(input, this.#compressionLevel));
    this.collectGarbage("update");
  }

  /**
   * Read without consuming the compressed bytes.
   *
   * Prefer `take()` or `process()` for idle-cache workflows where avoiding a
   * retained compressed copy matters.
   */
  public read(): T {
    return decodeSync(this.requireBuffer());
  }

  /**
   * Backwards-compatible alias for `read()`.
   *
   * Prefer `take()` or `process()` for memory-sensitive workflows.
   */
  public parse(): T {
    return this.read();
  }

  public async readAsync(): Promise<T> {
    return decodeAsync(this.requireBuffer());
  }

  /**
   * Consume the compressed bytes before returning the live JSON value.
   */
  public take(): T {
    let payload: EncodedPayload | undefined = this.releasePayload();

    try {
      const value = decodeSync<T>(payload.compressed);
      payload = undefined;
      this.collectGarbage("take");

      return value;
    } catch (error) {
      if (payload) {
        this.setPayload(payload);
      }

      throw error;
    }
  }

  /**
   * Backwards-compatible alias for `take()`.
   */
  public dump(): T {
    return this.take();
  }

  public async takeAsync(): Promise<T> {
    let payload: EncodedPayload | undefined = this.releasePayload();

    try {
      const value = await decodeAsync<T>(payload.compressed);
      payload = undefined;
      this.collectGarbage("take");

      return value;
    } catch (error) {
      if (payload) {
        this.setPayload(payload);
      }

      throw error;
    }
  }

  /**
   * Temporarily inflate the value, run work on it, then compress it again.
   *
   * During the callback this instance is empty. The previous payload is kept as
   * a fallback so it can be restored if recompression fails.
   */
  public process<R>(callback: (value: T) => R): R {
    const previousPayload = this.releasePayload();
    let liveValue: T;

    try {
      liveValue = decodeSync<T>(previousPayload.compressed);
      this.collectGarbage("take");
    } catch (error) {
      this.setPayload(previousPayload);

      throw error;
    }

    let result: R;

    try {
      result = callback(liveValue);
    } catch (error) {
      this.recompressOrRestoreThenThrow(liveValue, previousPayload, error);
    }

    if (isPromiseLike(result)) {
      observeAsyncProcessResult(result);

      this.recompressOrRestoreThenThrow(
        liveValue,
        previousPayload,
        new AsyncProcessCallbackError(),
      );
    }

    this.recompressOrRestore(liveValue, previousPayload);

    return result;
  }

  public async processAsync<R>(callback: (value: T) => R | Promise<R>): Promise<R> {
    const previousPayload = this.releasePayload();
    let liveValue: T;

    try {
      liveValue = await decodeAsync<T>(previousPayload.compressed);
      this.collectGarbage("take");
    } catch (error) {
      this.setPayload(previousPayload);

      throw error;
    }

    let result!: R;

    try {
      result = await callback(liveValue);
    } catch (error) {
      await this.recompressAsyncOrRestoreThenThrow(liveValue, previousPayload, error);
    }

    await this.recompressAsyncOrRestore(liveValue, previousPayload);

    return result;
  }

  public toBuffer(options: BufferOptions = {}): Buffer {
    const { copy = true } = options;
    const compressed = this.requireBuffer();

    return copy ? Buffer.from(compressed) : compressed;
  }

  public toBase64(): string {
    return this.requireBuffer().toString("base64");
  }

  public toEnvelope(): CompreSJONEnvelope {
    return {
      format: FORMAT,
      data: this.toBase64(),
      compressionLevel: this.#compressionLevel,
      jsonBytes: this.#jsonBytes,
    };
  }

  public toJSON(): CompreSJONEnvelope {
    return this.toEnvelope();
  }

  public toString(): string {
    return JSON.stringify(this.read());
  }

  public [inspect.custom](): string {
    const stats = this.stats;
    const jsonBytes = stats.jsonBytes ?? "unknown";
    const ratio = stats.ratio === undefined ? "unknown" : `${stats.ratio.toFixed(2)}x`;

    return `CompreSJON { compressedBytes: ${stats.compressedBytes}, jsonBytes: ${jsonBytes}, ratio: ${ratio}, isEmpty: ${stats.isEmpty} }`;
  }

  public dispose(): void {
    this.#compressed = EMPTY_BUFFER;
    this.#jsonBytes = undefined;
    this.collectGarbage("dispose");
  }

  public static parse<T>(json: CompreSJON<T>): T {
    return json.parse();
  }

  public static dump<T>(json: CompreSJON<T>): T {
    return json.dump();
  }

  public static stringify<T>(json: CompreSJON<T>): string {
    return json.toString();
  }

  private requireBuffer(): Buffer {
    if (this.#compressed.length === 0) {
      throw new EmptyBufferError();
    }

    return this.#compressed;
  }

  private releasePayload(): EncodedPayload {
    const compressed = this.requireBuffer();
    this.#compressed = EMPTY_BUFFER;
    const jsonBytes = this.#jsonBytes;
    this.#jsonBytes = undefined;

    return { compressed, jsonBytes };
  }

  private setPayload(payload: EncodedPayload): void {
    this.#compressed = payload.compressed;
    this.#jsonBytes = payload.jsonBytes;
  }

  private recompressOrRestore(value: T, previousPayload: EncodedPayload): void {
    try {
      this.update(value);
    } catch (error) {
      this.setPayload(previousPayload);

      throw error;
    }
  }

  private recompressOrRestoreThenThrow(
    value: T,
    previousPayload: EncodedPayload,
    errorToThrow: unknown,
  ): never {
    try {
      this.update(value);
    } catch {
      this.setPayload(previousPayload);
    }

    throw errorToThrow;
  }

  private async recompressAsyncOrRestore(value: T, previousPayload: EncodedPayload): Promise<void> {
    try {
      await this.updateAsync(value);
    } catch (error) {
      this.setPayload(previousPayload);

      throw error;
    }
  }

  private async recompressAsyncOrRestoreThenThrow(
    value: T,
    previousPayload: EncodedPayload,
    errorToThrow: unknown,
  ): Promise<never> {
    try {
      await this.updateAsync(value);
    } catch {
      this.setPayload(previousPayload);
    }

    throw errorToThrow;
  }

  private collectGarbage(phase: GarbageCollectionPhase): void {
    try {
      this.#garbageCollector?.(phase);
    } catch {
      // GC hooks are cleanup plumbing; they must not change cache semantics.
    }
  }
}

function isByteLike(input: unknown): input is Uint8Array {
  return input instanceof Uint8Array;
}

function isPromiseLike(input: unknown): input is PromiseLike<unknown> {
  return (
    input !== null &&
    (typeof input === "object" || typeof input === "function") &&
    typeof (input as { then?: unknown }).then === "function"
  );
}

function observeAsyncProcessResult(input: PromiseLike<unknown>): void {
  void Promise.resolve(input).catch(() => undefined);
}

function normalizeCompressionLevel(level = CompressionLevel.Balanced): number {
  if (!isCompressionLevel(level)) {
    throw new RangeError("compressionLevel must be an integer from 0 to 11.");
  }

  return level;
}

function isCompressionLevel(level: unknown): level is number {
  return typeof level === "number" && Number.isInteger(level) && level >= 0 && level <= 11;
}

function validatePayload(payload: CompreSJONEnvelope): void {
  if (
    payload === null ||
    typeof payload !== "object" ||
    payload.format !== FORMAT ||
    !isBase64(payload.data) ||
    (payload.compressionLevel !== undefined && !isCompressionLevel(payload.compressionLevel)) ||
    (payload.jsonBytes !== undefined &&
      (!Number.isSafeInteger(payload.jsonBytes) || payload.jsonBytes < 0))
  ) {
    throw new InvalidPayloadError();
  }
}

function isBase64(input: unknown): input is string {
  if (typeof input !== "string" || input.length === 0 || input.length % 4 !== 0) {
    return false;
  }

  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input);
}

function resolveGarbageCollector(gc: CompreSJONOptions["gc"]): GarbageCollector | undefined {
  if (typeof gc === "function") {
    return gc;
  }

  if (gc !== true) {
    return undefined;
  }

  return () => {
    const exposedGc = (globalThis as { gc?: () => void }).gc;

    if (exposedGc) {
      exposedGc();
    }
  };
}

function brotliOptions(compressionLevel: number, sizeHint: number) {
  return {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: compressionLevel,
      [constants.BROTLI_PARAM_SIZE_HINT]: sizeHint,
    },
  };
}

interface EncodedPayload {
  compressed: Buffer;
  jsonBytes?: number;
}

function jsonToBuffer(input: unknown): Buffer {
  let json: string | undefined;

  try {
    assertJsonValue(input);
    json = JSON.stringify(input);
  } catch (error) {
    throw asInvalidJsonValueError(error);
  }

  if (json === undefined) {
    throw new InvalidJsonValueError();
  }

  return Buffer.from(json, "utf8");
}

function assertJsonValue(input: unknown, activeObjects = new WeakSet<object>()): void {
  assertJsonPrimitive(input);

  if (input === null || typeof input !== "object") {
    return;
  }

  if (activeObjects.has(input)) {
    throw new TypeError("Cannot serialize circular JSON values.");
  }

  activeObjects.add(input);

  if (Array.isArray(input)) {
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const propertyNames = Object.getOwnPropertyNames(input).filter((key) => key !== "length");

    if (propertyNames.length !== input.length || Object.getOwnPropertySymbols(input).length > 0) {
      throw new InvalidJsonValueError();
    }

    for (let index = 0; index < input.length; index += 1) {
      if (!(index in input)) {
        throw new InvalidJsonValueError();
      }

      const descriptor = descriptors[index];

      if (!descriptor || !("value" in descriptor)) {
        throw new InvalidJsonValueError();
      }

      assertJsonValue(descriptor.value, activeObjects);
    }

    activeObjects.delete(input);

    return;
  }

  if (!isPlainObject(input) || typeof (input as { toJSON?: unknown }).toJSON === "function") {
    throw new InvalidJsonValueError();
  }

  const descriptors = Object.getOwnPropertyDescriptors(input);
  const propertyNames = Object.keys(input);

  if (propertyNames.length !== Object.getOwnPropertyNames(input).length) {
    throw new InvalidJsonValueError();
  }

  if (Object.getOwnPropertySymbols(input).length > 0) {
    throw new InvalidJsonValueError();
  }

  for (const key of propertyNames) {
    const descriptor = descriptors[key];

    if (!descriptor || !("value" in descriptor)) {
      throw new InvalidJsonValueError();
    }

    assertJsonValue(descriptor.value, activeObjects);
  }

  activeObjects.delete(input);
}

function assertJsonPrimitive(input: unknown): void {
  switch (typeof input) {
    case "number":
      if (!Number.isFinite(input)) {
        throw new InvalidJsonValueError();
      }

      return;

    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new InvalidJsonValueError();

    default:
      return;
  }
}

function isPlainObject(input: object): boolean {
  const prototype = Object.getPrototypeOf(input);

  return prototype === Object.prototype || prototype === null;
}

function asInvalidJsonValueError(error: unknown): InvalidJsonValueError {
  return error instanceof InvalidJsonValueError ? error : new InvalidJsonValueError(error);
}

function bufferToValue<T>(input: Buffer): T {
  return JSON.parse(input.toString("utf8")) as T;
}

function encodeSync(input: unknown, compressionLevel: number): EncodedPayload {
  const json = jsonToBuffer(input);
  const compressed = brotliCompressSync(json, brotliOptions(compressionLevel, json.length));

  return { compressed, jsonBytes: json.length };
}

async function encodeAsync(input: unknown, compressionLevel: number): Promise<EncodedPayload> {
  const json = jsonToBuffer(input);
  const compressed = await compress(json, brotliOptions(compressionLevel, json.length));

  return { compressed, jsonBytes: json.length };
}

function decodeSync<T>(input: Buffer): T {
  try {
    return bufferToValue<T>(brotliDecompressSync(input));
  } catch (error) {
    throw asInvalidCompressedDataError(error);
  }
}

async function decodeAsync<T>(input: Buffer): Promise<T> {
  try {
    return bufferToValue<T>(await decompress(input));
  } catch (error) {
    throw asInvalidCompressedDataError(error);
  }
}

function asInvalidCompressedDataError(error: unknown): InvalidCompressedDataError {
  return error instanceof InvalidCompressedDataError
    ? error
    : new InvalidCompressedDataError(error);
}
