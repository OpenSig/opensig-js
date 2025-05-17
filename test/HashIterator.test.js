import { HashIterator } from '../src/opensig.js';
import { hash } from '../src/crypto.js';
import { buf2hex } from '../src/utils.js';

describe('HashIterator', () => {

  const createDummyHash = () => new Uint8Array(32).fill(1); // 32-byte buffer

  test('generates correct number of hashes', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);
    const hashes = await iterator.next(5);
    expect(hashes.length).toBe(5);
  });

  test('generates hashes deterministically', async () => {
    const docHash = createDummyHash();
    const iter1 = new HashIterator(docHash, 1);
    const iter2 = new HashIterator(docHash, 1);

    const hashes1 = await iter1.next(5);
    const hashes2 = await iter2.next(5);

    for (let i = 0; i < 5; i++) {
      expect(buf2hex(hashes1[i])).toBe(buf2hex(hashes2[i]));
    }
  });

  test('current() returns latest hash', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);

    await iterator.next(3);
    const current = iterator.current();

    expect(current).toBeDefined();
    expect(buf2hex(current)).toBe(buf2hex(iterator.indexAt(2)));
  });

  test('reset() repositions the pointer', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);

    await iterator.next(4);
    expect(iterator.currentIndex()).toBe(3);

    iterator.reset(1);
    expect(iterator.currentIndex()).toBe(1);
    expect(buf2hex(iterator.current())).toBe(buf2hex(iterator.indexAt(1)));
  });

  test('indexOf returns correct index', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);

    const hashes = await iterator.next(5);
    const index = iterator.indexOf(buf2hex(hashes[2]));
    expect(index).toBe(2);
  });

  test('hash chain is unique and sequential', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);
    const hashes = await iterator.next(10);
    const hexHashes = hashes.map(h => buf2hex(h));

    const unique = new Set(hexHashes);
    expect(unique.size).toBe(10); // All hashes should be unique
  });

  test('next returns the correct slice', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);
    await iterator.next(3);
    const slice = await iterator.next(2);
    expect(slice.length).toBe(2);
    expect(buf2hex(slice[0])).toBe(buf2hex(iterator.indexAt(3)));
    expect(buf2hex(slice[1])).toBe(buf2hex(iterator.indexAt(4)));
  });

  test('next() with no argument returns one hash', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);
    const hash = await iterator.next();
    expect(hash.length).toBe(1);
    expect(buf2hex(hash[0])).toBe(buf2hex(iterator.indexAt(0)));
  });

  test('next after reset returns the correct hashes', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);
    await iterator.next(3);
    iterator.reset(1);
    const hashes = await iterator.next(2);
    expect(hashes.length).toBe(2);
    expect(buf2hex(hashes[0])).toBe(buf2hex(iterator.indexAt(2)));
    expect(buf2hex(hashes[1])).toBe(buf2hex(iterator.indexAt(3)));
  });

  test('size returns the correct number of hashes', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);
    await iterator.next(5);
    expect(iterator.size()).toBe(5);
  });

  test('size after reset reflects the reset', async () => {
    const docHash = createDummyHash();
    const iterator = new HashIterator(docHash, 1);
    await iterator.next(5);
    expect(iterator.size()).toBe(5);
    iterator.reset(2);
    expect(iterator.size()).toBe(3); // reset to index 2, so 3 hashes left
  });

  describe('hashes', () => {

    // H = hash (returns hexstring)
    // Hd = document hash: H(document)
    // Hc = chain specific hash: H(stringConcat(chainIdAsStr, Hd))

    test('chain specific hash is H(concat(chainId,Hd))', async () => {
      const docHash = createDummyHash();
      const chainId = 1;
      const iterator = new HashIterator(docHash, chainId);
      await iterator.next(1); // chain specific hash is generated on the first call
      const chainIdAsStr = String(chainId);
      const expectedHash = await hash(new Uint8Array([chainIdAsStr, ...docHash]));
      expect(buf2hex(iterator.chainSpecificHash)).toBe(buf2hex(expectedHash));
    });

    test('chain specific hash correctly encodes for high chainId', async () => {
      const docHash = createDummyHash();
      const chainId = 987654321; // High chainId
      const iterator = new HashIterator(docHash, chainId);
      await iterator.next(1); // chain specific hash is generated on the first call
      const chainIdAsStr = String(chainId);
      const expectedHash = await hash(new Uint8Array([...Uint8Array.from(chainIdAsStr), ...docHash]));
      expect(buf2hex(iterator.chainSpecificHash)).toBe(buf2hex(expectedHash));
    });

    test('first signature is H(Hc)', async () => {
      const docHash = createDummyHash();
      const chainId = 4;
      const iterator = new HashIterator(docHash, chainId);
      await iterator.next(1);
      const chainSpecificHash = await hash(new Uint8Array([String(chainId), ...docHash]));
      const expectedHash = await hash(chainSpecificHash);
      expect(buf2hex(iterator.chainSpecificHash)).toBe(buf2hex(chainSpecificHash));
      expect(buf2hex(iterator.indexAt(0))).toBe(buf2hex(expectedHash));
    });

    test('second signature is H(concat(Hc,H1))', async () => {
      const docHash = createDummyHash();
      const chainId = 4;
      const iterator = new HashIterator(docHash, chainId);
      await iterator.next(2); 
      const chainSpecificHash = await hash(new Uint8Array([String(chainId), ...docHash]));
      const hash1 = await hash(chainSpecificHash);
      const hash2 = await hash(new Uint8Array([...new Uint8Array(chainSpecificHash), ...new Uint8Array(hash1)]));
      expect(buf2hex(iterator.chainSpecificHash)).toBe(buf2hex(chainSpecificHash));
      expect(buf2hex(iterator.indexAt(0))).toBe(buf2hex(hash1));
      expect(buf2hex(iterator.indexAt(1))).toBe(buf2hex(hash2));
    });

    test('Nth signature is Hn(concat(Hc,Hn-1))', async () => {
      const docHash = createDummyHash();
      const chainId = 4;
      const iterator = new HashIterator(docHash, chainId);
      await iterator.next(100); 
      const chainSpecificHash = await hash(new Uint8Array([String(chainId), ...docHash]));
      const hash1 = await hash(chainSpecificHash);
      expect(buf2hex(iterator.chainSpecificHash)).toBe(buf2hex(chainSpecificHash));
      expect(buf2hex(iterator.indexAt(0))).toBe(buf2hex(hash1));
      const chainSpecificHashArr = new Uint8Array(chainSpecificHash);
      let previousHash = new Uint8Array(hash1);
      for (let i = 1; i < 100; i++) {
        const hashN = await hash(new Uint8Array([...chainSpecificHashArr, ...previousHash]));
        expect(buf2hex(iterator.indexAt(i))).toBe(buf2hex(hashN));
        previousHash = new Uint8Array(hashN);
      }
    });

    test('consecutive next calls return the correct hashes', async () => {
      const docHash = createDummyHash();
      const chainId = 4;
      const iterator = new HashIterator(docHash, chainId);
      const chainSpecificHash = await hash(new Uint8Array([String(chainId), ...docHash]));
      const hash1 = await hash(chainSpecificHash);
      let uutHash = await iterator.next();
      expect(uutHash.length).toBe(1);
      expect(buf2hex(uutHash[0])).toBe(buf2hex(hash1));
      const chainSpecificHashArr = new Uint8Array(chainSpecificHash);
      let previousHash = new Uint8Array(hash1);
      for (let i = 1; i < 100; i++) {
        const hashN = await hash(new Uint8Array([...chainSpecificHashArr, ...previousHash]));
        uutHash = await iterator.next();
        expect(uutHash.length).toBe(1);
        expect(buf2hex(uutHash[0])).toBe(buf2hex(hashN));
        previousHash = new Uint8Array(hashN);
      }
      expect(iterator.size()).toBe(100);
    });

  });

});
