import CompreSJON from './index';
import { expect } from 'chai';

describe('CompreSJON', () => {
  describe('object', () => {
    let json: CompreSJON<Record<string, string>>;

    beforeEach(() => {
      json = new CompreSJON({ hello: 'world' });
    });

    describe('constructor', () => {
      it('should create a new instance from a Buffer', () => {
        const instance = new CompreSJON<Record<string, string>>(json.buffer);

        expect(instance.buffer.equals(json.buffer)).to.be.true;
      });
    });

    describe('stringify', () => {
      it('should stringify the data', () => {
        const stringified = CompreSJON.stringify(json);

        expect(stringified).to.equal('{"hello":"world"}');
      });
    });

    describe('parse', () => {
      it('should parse the data', () => {
        const parsed = CompreSJON.parse(json);

        expect(parsed).to.deep.equal({ hello: 'world' });
      });
    });

    describe('update', () => {
      it('should update the data', () => {
        json.update({ hello: 'you' });
        const parsed = CompreSJON.parse(json);

        expect(parsed).to.deep.equal({
          hello: 'you',
        });
      });
    });

    describe('dump', () => {
      it('should dump the data', () => {
        const parsed = CompreSJON.dump(json);

        expect(json.buffer).to.have.length(0);
        expect(parsed).to.deep.equal({
          hello: 'world',
        });
      });
    });
  });

  describe('array', () => {
    let json: CompreSJON<string[]>;

    beforeEach(() => {
      json = new CompreSJON(['hello', 'world']);
    });

    describe('stringify', () => {
      it('should stringify the data', () => {
        const stringified = CompreSJON.stringify(json);

        expect(stringified).to.equal('["hello","world"]');
      });
    });

    describe('parse', () => {
      it('should parse the data', () => {
        const parsed = CompreSJON.parse(json);

        expect(parsed).to.deep.equal(['hello', 'world']);
      });
    });

    describe('update', () => {
      it('should update the data', () => {
        json.update(['hello', 'you']);
        const parsed = CompreSJON.parse(json);

        expect(parsed).to.deep.equal(['hello', 'you']);
      });
    });

    describe('dump', () => {
      it('should dump the data', () => {
        const parsed = CompreSJON.dump(json);

        expect(json.buffer).to.have.length(0);
        expect(parsed).to.deep.equal(['hello', 'world']);
      });
    });

    describe('process', () => {
      it('should dump the internal data while processing', () => {
        json.process((data) => {
          expect(json.buffer).to.have.length(0);
          expect(data).to.deep.equal(['hello', 'world']);
        });

        const parsed = CompreSJON.parse(json);
        expect(parsed).to.deep.equal(['hello', 'world']);
      });
    });
  });
});
