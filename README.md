# compresjon

[![npm](https://img.shields.io/npm/v/compresjon)](https://www.npmjs.com/package/compresjon)

`compresjon` is a lightweight npm package designed for storing large amounts of data in a compressed and serialized format. It is particularly useful for long-running processes that require infrequent access to data, such as cold storage during interval downtimes.

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

### Pros and Cons

It's important to note that `compresjon` is optimized for storing large amounts of data that are infrequently accessed. It may not be suitable for scenarios that require frequent read or write operations on the data due to the serialization overhead that it introduces.
