import CompreSJON from './index';
import { expect } from 'chai';

describe('CompreSJON', () => {
  describe('object', () => {
    let json: CompreSJON<Record<string, string>>;

    beforeEach(() => {
      json = new CompreSJON({ hello: 'world' });
    });

    describe('stringify', () => {
      it('should stringify the data', () => {
        const stringified = CompreSJON.stringify(json);

        expect(stringified).to.equal('{"hello":"world"}');
      });
    });

    describe('parse', () => {
      it('should parse the data', () => {
        const parsed = CompreSJON.parseSync(json);

        expect(parsed).to.deep.equal({ hello: 'world' });
      });
    });

    describe('update', () => {
      it('should update the data', async () => {
        await json.update({ hello: 'you' });
        const parsed = CompreSJON.parseSync(json);

        expect(parsed).to.deep.equal({
          hello: 'you',
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
        const parsed = CompreSJON.parseSync(json);

        expect(parsed).to.deep.equal(['hello', 'world']);
      });
    });

    describe('update', () => {
      it('should update the data', async () => {
        await json.update(['hello', 'you']);
        const parsed = CompreSJON.parseSync(json);

        expect(parsed).to.deep.equal(['hello', 'you']);
      });
    });
  });
});
