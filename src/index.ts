import { EmptyBufferError } from 'helpers/Error';
import type Input from 'types/Input';
import JsonValue from 'types/JsonValue';
import { brotliCompressSync, brotliDecompressSync, constants } from 'zlib';
import { encode, decode } from '@msgpack/msgpack';
import CompressionLevel from 'enums/CompressionLevel';

export { default as CompressionLevel } from 'enums/CompressionLevel';

interface Options {
  /**
   * The compression level to use when compressing the JSON. Default is `CompressionLevel.Default`.
   */
  compressionLevel?: CompressionLevel | number;
}

/**
 * An optimized JSON object that has been serialized and compressed.
 *
 * ```ts
 * import CompreSJON from 'compresjon';
 *
 * const json = new CompreSJON({ hello: 'world' });
 * ```
 */
export default class CompreSJON<T extends Input> {
  public buffer: Buffer;
  private readonly compressionLevel: CompressionLevel | number =
    CompressionLevel.Default;

  constructor(input: T | Buffer, options?: Options) {
    if (options?.compressionLevel) {
      this.compressionLevel = options.compressionLevel;
    }

    if (Buffer.isBuffer(input)) {
      this.buffer = input;
    } else {
      this.buffer = this._serialize(input);
    }
  }

  private _serialize(input: Input): Buffer {
    const buffer = encode(input);

    /**
     * @see https://nodejs.org/api/html#zlib_class_brotlioptions
     */
    return brotliCompressSync(buffer, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_QUALITY]: this.compressionLevel,
        [constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
      },
    });
  }

  private _deserialize(): T {
    const data = brotliDecompressSync(this.buffer);

    return decode(data) as T;
  }

  private _destructiveDeserialize(): T {
    const data = brotliDecompressSync(this.buffer);
    this.buffer = Buffer.alloc(0);

    return decode(data) as T;
  }

  /**
   * Replaces the existing data within the buffer with the new data.
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * json.update({ hello: 'universe' });
   * console.log(CompreSJON.parse(json)); // { hello: 'universe' }
   * ```
   */
  public update(input: T extends Array<infer U> ? Array<U> : JsonValue) {
    this.buffer = this._serialize(input);
  }

  /**
   * Allows you to process the JavaScript Object Notation (JSON) representation of the internal
   * buffer without having to worry about having two copies of the data in memory. This is identical
   * to doing:
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * const data = CompreSJON.dump(json);
   * // Perform logic on data
   * json.update(data);
   * ```
   *
   * @param cb A callback function that will be called with the parsed data.
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * json.process((data) => console.log(data)); // { hello: 'world' }
   * ```
   */
  public process(cb: (json: T) => void) {
    const data = this._destructiveDeserialize();
    cb(data);

    this.buffer = this._serialize(data);
  }

  /**
   * @deprecated The intended use case of this method is to allow API frameworks to leverage
   * the `CompreSJON` class as a response type. This method will be called
   * automatically by `JSON.stringify` when the `CompreSJON` class is passed in.
   *
   * This returns the raw buffer of the compressed JSON.
   */
  public toJSON() {
    return this.buffer;
  }

  /**
   * Converts a JavaScript Object Notation (JSON) into a CompreSJON.
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * console.log(json.stringify()); // '{"hello":"world"}'
   * ```
   */
  public toString(): string {
    const data = this._deserialize();

    return JSON.stringify(data);
  }

  /**
   * Converts a JavaScript Object Notation (JSON) into a CompreSJON.
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * console.log(CompreSJON.stringify(json)); // '{"hello":"world"}'
   * ```
   */
  public static stringify<T extends Input>(json: CompreSJON<T>): string {
    return json.toString();
  }

  /**
   * Converts a CompreSJON into a JavaScript Object Notation (JSON).
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * const data = json.parse();
   * console.log(data); // { hello: 'world' }
   * ```
   */
  public parse() {
    if (this.buffer.length === 0) {
      throw new EmptyBufferError();
    }

    return this._deserialize();
  }

  /**
   * Converts a CompreSJON into a JavaScript Object Notation (JSON).
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * const data = CompreSJON.parse(json);
   * console.log(data); // { hello: 'world' }
   * ```
   */
  public static parse<T extends Input>(json: CompreSJON<T>) {
    return json.parse();
  }

  /**
   * Similar to `CompreSJON.parse`, but empties the internal buffer in the
   * process. This is useful if you want to avoid having two copies of the data
   * in memory.
   *
   * __Attention: This is a destructive action and will clear the internal buffer.__
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * const data = json.dump();
   * console.log(data); // { hello: 'world' }
   * console.log(json.buffer.length); // 0
   * ```
   */
  public dump() {
    if (this.buffer.length === 0) {
      throw new EmptyBufferError();
    }

    return this._destructiveDeserialize();
  }

  /**
   * Similar to `CompreSJON.parse`, but empties the internal buffer in the
   * process. This is useful if you want to avoid having two copies of the data
   * in memory.
   *
   * __Attention: This is a destructive action and will clear the internal buffer.__
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * const data = CompreSJON.dump(json);
   * console.log(data); // { hello: 'world' }
   * console.log(json.buffer.length); // 0
   * ```
   */
  public static dump<T extends Input>(json: CompreSJON<T>) {
    return json.dump();
  }
}
