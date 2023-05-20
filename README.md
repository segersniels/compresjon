# CompreSJON

[![npm](https://img.shields.io/npm/v/compresjon)](https://www.npmjs.com/package/compresjon)

`compresjon` is a lightweight package designed for storing JSON data in a compressed and serialized format. It is particularly useful for long-running processes that require infrequent access to data, such as cold storage during interval downtimes.

<p align="center">
<img src="./resources/logo.png" width="300">

## Installation

```
npm install compresjon
```

## Usage

```ts
import CompreSJON from 'compresjon';

const json = new CompreSJON({ hello: 'world' });
```

### Updating Data

Converts a JavaScript Object Notation (JSON) string into a CompreSJON.

```ts
const json = new CompreSJON({ hello: 'world' });
json.update({ hello: 'universe' });
console.log(CompreSJON.parse(json)); // { hello: 'universe' }
```

### Serializing and Deserializing

You can stringify a `CompreSJON` instance using the static `stringify` method:

```ts
const json = new CompreSJON({ hello: 'world' });
console.log(CompreSJON.stringify(json)); // '{"hello":"world"}'
```

You can convert a `CompreSJON` instance back to JSON using the static `parse` method:

```ts
const json = new CompreSJON({ hello: 'world' });
console.log(CompreSJON.parse(json)); // { hello: 'world' }
```

Keep in mind that when using `parse` that there will be two instances of the JSON data in memory during the runtime. Both the internal binary representation and the parsed JSON. So depending on your use case you can look into `dump`:

```ts
const json = new CompreSJON({ hello: 'world' });
console.log(CompreSJON.dump(json)); // { hello: 'world' }
console.log(json.buffer.length); // 0
```

Dumping the data will return the parsed JSON while also clearing the internal binary reference. This means that the only instance available, during the runtime after `dump`, is the parsed JSON. Just don't forget to `update` with the updated data once it's ready to be compressed again.

### Pros and Cons

It's important to note that `compresjon` is optimized for storing large amounts of data that are infrequently accessed. It may not be suitable for scenarios that require frequent read or write operations on the data due to the serialization overhead that it introduces.
