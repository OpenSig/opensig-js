// function require(path) {
//   return import(path);
// }

import { beforeAll, describe, expect, jest, test } from '@jest/globals';
import { buf2hex, hexToBuf } from '../src/utils';

// ------ Test Configuration ------

const OPENSIG_PROTOCOL_CONSTANTS = {
  SIGNATURE_DATA_VERSION: "00",
  SIGNATURE_DATA_UNENCRYPTED_STRING: "00",
  SIGNATURE_DATA_UNENCRYPTED_BINARY: "01",
  SIGNATURE_DATA_ENCRYPTED_STRING: "80",
  SIGNATURE_DATA_ENCRYPTED_BINARY: "81",
}

// ------ Test Helpers ------

const _crypto = crypto || window.crypto || {};

function _getSubtleCrypto() {
  if (!_crypto.subtle) throw new Error("Missing crypto capability");
  return crypto.subtle;
}

// Independent function to hash data using SHA-256. Used by the first version of opensig-js
export async function aesgcmEncrypt(keyBuffer, nonce, data) {
  const key = await _getSubtleCrypto().importKey("raw", keyBuffer, {name: 'AES-GCM'}, true, ['encrypt', 'decrypt']);
  const algorithm = {
    name: 'AES-GCM',
    iv: nonce,
  };
  const encryptedData = await _getSubtleCrypto().encrypt(algorithm, key, data);
  return encryptedData;
}

// Helper function to convert a string to a UTF-16 (big endian) hex string
function encodeUTF16BE(str) {
  const buf = new Uint8Array(str.length * 2); // 2 bytes per char
  for (let i = 0; i < str.length; i++) {
    const codeUnit = str.charCodeAt(i); // UTF-16 code unit
    buf[i * 2] = (codeUnit >> 8) & 0xFF;     // High byte first (big endian)
    buf[i * 2 + 1] = codeUnit & 0xFF;        // Low byte second
  }
  return buf;
}



// ------ Mocks ------

const mockNetwork = {
  chainId: 1,
  publishSignature: jest.fn(() => Promise.resolve({
    txHash: '0x123',
    signatory: '0xabc',
    signature: '0xsig',
    confirmationInformer: Promise.resolve('confirmed'),
  })),
  querySignatures: jest.fn(() => Promise.resolve([])),
};


let opensig;
let ethers;

beforeAll(async () => {
  // Isolate module loading after mocks
  await jest.isolateModulesAsync(async () => {
    opensig = await import('../src/opensig');
    // opensig.setLogTrace(true);
    ethers = await import('ethers');
  });
});


describe('OpenSig Document class', () => {

  const sampleHash = Buffer.from("abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890", 'hex');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Signing', () => {

    describe('Invalid parameters', () => {

      test('Invalid data type throws error', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        await expect(doc.sign({ type: 'invalid-type', content: 'hello', encrypted: true }))
          .rejects.toThrow("invalid data type 'invalid-type'");
      });

      test('Invalid string content throws error', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        await expect(doc.sign({ type: 'string', content: 123, encrypted: true }))
          .rejects.toThrow("invalid data content");
      });

      test('Invalid binary content throws error', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        await expect(doc.sign({ type: 'hex', content: 123, encrypted: true }))
          .rejects.toThrow("invalid data content");
      });

      test('Invalid hex string throws error', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        await expect(doc.sign({ type: 'hex', content: '0xabcdef0g', encrypted: true }))
          .rejects.toThrow("invalid data content");
      });

      test('Invalid data encrypted flag throws error', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        await expect(doc.sign({ type: 'string', content: 'hello', encrypted: "invalid" }))
          .rejects.toThrow("invalid data encrypted flag");
      });

    });

    test('Document throws if signed without verification', async () => {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      await expect(doc.sign()).rejects.toThrow("Must verify before signing");
    });

    test('Document encryption key is the document hash', async () => {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      await doc.verify();
      expect(doc.encryptionKey.hash).toEqual(sampleHash);
    });

    test('Document can sign after verification', async () => {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      await doc.verify();
      const result = await doc.sign({ type: 'string', content: 'hello', encrypted: true });
      expect(result.txHash).toBe('0x123');
      expect(mockNetwork.publishSignature).toHaveBeenCalled();
    });

    test('Unsigned document signs with first signature', async () => {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      await doc.verify();
      expect(doc.hashes.currentIndex()).toBe(-1);
      expect(mockNetwork.querySignatures.mock.calls[0][0].length).toBe(10);
      const result = await doc.sign({ type: 'string', content: 'hello', encrypted: true });
      expect(result.txHash).toBe('0x123');
      expect(mockNetwork.publishSignature).toHaveBeenCalled();
      expect(doc.hashes.currentIndex()).toBe(0);
      expect(buf2hex(doc.hashes.indexAt(0)).length).toBe(66);
      expect(mockNetwork.publishSignature.mock.calls[0][0]).toEqual(buf2hex(doc.hashes.indexAt(0)));
    });

    test('Signed document signs with next available signature', async () => {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      await doc.verify();
      const result1 = await doc.sign({ type: 'string', content: 'hello', encrypted: true });
      expect(result1.txHash).toBe('0x123');
      expect(doc.hashes.currentIndex()).toBe(0);
      expect(buf2hex(doc.hashes.indexAt(0)).length).toBe(66);
      const result2 = await doc.sign({ type: 'string', content: 'world', encrypted: true });
      expect(result2.txHash).toBe('0x123');
      expect(mockNetwork.publishSignature).toHaveBeenCalled();
      expect(mockNetwork.publishSignature.mock.calls.length).toBe(2);
      expect(mockNetwork.publishSignature.mock.calls[0][0]).toEqual(buf2hex(doc.hashes.indexAt(0)));
      expect(mockNetwork.publishSignature.mock.calls[1][0]).toEqual(buf2hex(doc.hashes.indexAt(1)));
      expect(buf2hex(doc.hashes.indexAt(0))).not.toEqual(buf2hex(doc.hashes.indexAt(1)));
      expect(doc.hashes.currentIndex()).toBe(1);
    });

    test('Passing no data signs with empty hex', async () => {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      await doc.verify();
      const result = await doc.sign();
      expect(result.txHash).toBe('0x123');
      expect(mockNetwork.publishSignature).toHaveBeenCalled();
      expect(mockNetwork.publishSignature.mock.calls[0][1]).toEqual("0x");
    });

    test('Document cannot be signed while signing is in progress', async () => {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      await doc.verify();
      mockNetwork.publishSignature.mockImplementationOnce(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              txHash: '0x123',
              signatory: '0xabc',
              signature: '0xsig',
              confirmationInformer: Promise.resolve('confirmed'),
            });
          }, 100);
        });
      });
      const promise1 = doc.sign({ type: 'string', content: 'hello', encrypted: true });
      expect(doc.sign({ type: 'string', content: 'world', encrypted: true }))
        .rejects.toThrow("Signing already in progress");
      const result1 = await promise1;
      expect(result1.txHash).toBe('0x123');
      expect(mockNetwork.publishSignature).toHaveBeenCalled();
      expect(mockNetwork.publishSignature.mock.calls.length).toBe(1);
      expect(mockNetwork.publishSignature.mock.calls[0][0]).toEqual(buf2hex(doc.hashes.indexAt(0)));
      expect(doc.hashes.currentIndex()).toBe(0);
    });

    test('Failed signature publish throws error and can be tried again', async () => {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      await doc.verify();
      mockNetwork.publishSignature.mockImplementationOnce(() => {
        return Promise.reject(new Error("Failed to publish signature"));
      });
      await expect(doc.sign({ type: 'string', content: 'hello', encrypted: true }))
        .rejects.toThrow("Failed to publish signature");
      expect(mockNetwork.publishSignature).toHaveBeenCalled();
      expect(mockNetwork.publishSignature.mock.calls.length).toBe(1);
      expect(mockNetwork.publishSignature.mock.calls[0][0]).toEqual(buf2hex(doc.hashes.indexAt(0)));
      expect(doc.hashes.currentIndex()).toBe(-1);
      const result = await doc.sign({ type: 'string', content: 'hello', encrypted: true });
      expect(result.txHash).toBe('0x123');
      expect(mockNetwork.publishSignature).toHaveBeenCalled();
      expect(mockNetwork.publishSignature.mock.calls.length).toBe(2);
      expect(mockNetwork.publishSignature.mock.calls[1][0]).toEqual(buf2hex(doc.hashes.indexAt(0)));
      expect(doc.hashes.currentIndex()).toBe(0);
    });


    describe('Annotations', () => {

      test('Data is published as hex string', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        await doc.sign({ type: 'string', content: 'hello', encrypted: true });
        expect(mockNetwork.publishSignature).toHaveBeenCalled();
        expect(mockNetwork.publishSignature.mock.calls[0][1]).toMatch(/0x[a-fA-F0-9]+/);
        expect(mockNetwork.publishSignature.mock.calls[0][1].length % 2).toBe(0); // even number of hex digits
      });

      test('Data version is 0x00', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        await doc.sign({ type: 'string', content: 'hello', encrypted: true });
        expect(mockNetwork.publishSignature).toHaveBeenCalled();
        const data = mockNetwork.publishSignature.mock.calls[0][1];
        expect(data.slice(0, 2)).toEqual("0x");
        expect(data.slice(2, 4)).toEqual(OPENSIG_PROTOCOL_CONSTANTS.SIGNATURE_DATA_VERSION);
      });

      test('Unencrypted annotation is published plaintext unicode', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        await doc.sign({ type: 'string', content: 'hello', encrypted: false });
        expect(mockNetwork.publishSignature).toHaveBeenCalled();
        const data = mockNetwork.publishSignature.mock.calls[0][1];
        expect(data.slice(0, 2)).toEqual("0x");
        expect(data.slice(2, 4)).toEqual(OPENSIG_PROTOCOL_CONSTANTS.SIGNATURE_DATA_VERSION);
        expect(data.slice(4, 6)).toEqual(OPENSIG_PROTOCOL_CONSTANTS.SIGNATURE_DATA_UNENCRYPTED_STRING);
        const annotation = data.slice(6);
        const expectedAnnotation = buf2hex(encodeUTF16BE("hello")).slice(2);
        expect(annotation).toEqual(expectedAnnotation);
      });

      test('Unencrypted binary annotation is published without encryption', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
        await doc.sign({ type: 'hex', content: buf2hex(binaryData), encrypted: false });
        expect(mockNetwork.publishSignature).toHaveBeenCalled();
        const data = mockNetwork.publishSignature.mock.calls[0][1];
        expect(data.slice(0, 2)).toEqual("0x");
        expect(data.slice(2, 4)).toEqual(OPENSIG_PROTOCOL_CONSTANTS.SIGNATURE_DATA_VERSION);
        expect(data.slice(4, 6)).toEqual(OPENSIG_PROTOCOL_CONSTANTS.SIGNATURE_DATA_UNENCRYPTED_BINARY);
        const annotation = data.slice(6);
        const expectedAnnotation = buf2hex(binaryData.buffer).slice(2);
        expect(annotation).toEqual(expectedAnnotation);
      });

      test('Encrypted annotation string is encrypted with the document hash', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        await doc.sign({ type: 'string', content: 'hello', encrypted: true });
        expect(mockNetwork.publishSignature).toHaveBeenCalled();
        const data = mockNetwork.publishSignature.mock.calls[0][1];
        expect(data.slice(0, 2)).toEqual("0x");
        expect(data.slice(2, 4)).toEqual(OPENSIG_PROTOCOL_CONSTANTS.SIGNATURE_DATA_VERSION);
        expect(data.slice(4, 6)).toEqual(OPENSIG_PROTOCOL_CONSTANTS.SIGNATURE_DATA_ENCRYPTED_STRING);
        const annotation = data.slice(6);
        // Encrypted data field is concat(nonce, encrypted-data) where nonce is 12 randome bytes
        const nonce = hexToBuf(annotation.slice(0, 24));
        const encryptedData = await aesgcmEncrypt(sampleHash, nonce, encodeUTF16BE("hello"));
        expect(annotation).toEqual(buf2hex(nonce).slice(2) + buf2hex(encryptedData).slice(2));
      });

      test('Encrypted annotation binary is encrypted with the document hash', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        await doc.verify();
        const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
        await doc.sign({ type: 'hex', content: buf2hex(binaryData), encrypted: true });
        expect(mockNetwork.publishSignature).toHaveBeenCalled();
        const data = mockNetwork.publishSignature.mock.calls[0][1];
        expect(data.slice(0, 2)).toEqual("0x");
        expect(data.slice(2, 4)).toEqual(OPENSIG_PROTOCOL_CONSTANTS.SIGNATURE_DATA_VERSION);
        expect(data.slice(4, 6)).toEqual(OPENSIG_PROTOCOL_CONSTANTS.SIGNATURE_DATA_ENCRYPTED_BINARY);
        const annotation = data.slice(6);
        // Encrypted data field is concat(nonce, encrypted-data) where nonce is 12 randome bytes
        const nonce = hexToBuf(annotation.slice(0, 24));
        const encryptedData = await aesgcmEncrypt(sampleHash, nonce, binaryData);
        expect(annotation).toEqual(buf2hex(nonce).slice(2) + buf2hex(encryptedData).slice(2));
      });

    });  // End of Annotations

  });  // End of Signing


  describe('Verifying', () => {

    let hashChain = [];
    let eventInterface;

    const defaultEventLog = {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      blockHash: "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
      removed: false,
      transactionHash: "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8",
      transactionIndex: 0,
    };

    function constructSimulatedEvents(events) {
      const eventFragment = eventInterface.getEvent("Signature");
      const eventTopic = ethers.id("Signature(uint256,address,bytes32,bytes)");
      return events.map(([time, signer, signature, data], i) => {
        const { data: encodedData } = eventInterface.encodeEventLog(eventFragment, [time, signer, signature, data]);
        return {
          ...defaultEventLog,
          logIndex: i,
          data: encodedData, 
          topics: [eventTopic, ethers.zeroPadValue(signer, 32), signature], 
          blockNumber: i + 1
        };
      });
    }

    async function testEventDecoding(eventData, expectedAnnotation) {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      const signer1 = ethers.Wallet.createRandom().address;
      const events = constructSimulatedEvents([
        [1234567890, signer1, hashChain[0], eventData]
      ]);
      mockNetwork.querySignatures.mockResolvedValueOnce(events);
      const signatures = await doc.verify();
      expect(signatures.length).toBe(1);
      expect(signatures[0].time).toBe(1234567890);
      expect(signatures[0].signatory).toBe(signer1);
      expect(signatures[0].signature).toBe(hashChain[0]);
      expect(signatures[0].data).toMatchObject(expectedAnnotation);
    }

    beforeAll(async () => {
      const iterator = new opensig.HashIterator(sampleHash);
      hashChain = (await iterator.next(100)).map(h => buf2hex(h));
      eventInterface = new ethers.Interface([
        "event Signature(uint256 time, address indexed signer, bytes32 indexed signature, bytes data)"
      ]);
    });

    test('Queries the blockchain in batches of 10', async () => {
      const doc = new opensig.Document(mockNetwork, sampleHash);
      await doc.verify();
      expect(mockNetwork.querySignatures).toHaveBeenCalled();
      expect(mockNetwork.querySignatures.mock.calls[0][0].length).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(mockNetwork.querySignatures.mock.calls[0][0][i]).toEqual(buf2hex(doc.hashes.indexAt(i)));
        expect(mockNetwork.querySignatures.mock.calls[0][0][i].length).toEqual(66);
      }
    });

    describe('Signature event decoding', () => {

      test('Event with no data is decoded correctly', async () => {
        return testEventDecoding(
          '0x',
          { type: 'none' }
        );
      });

      test('Event without annotation is decoded correctly', async () => {
        return testEventDecoding(
          '0x0000',
          { type: 'string', content: '', encrypted: false, version: '00' }
        );
      });

      test('Event with string annotation is decoded correctly', async () => {
        return testEventDecoding(
          '0x0000' + buf2hex(encodeUTF16BE("hello")).slice(2),
          {type: 'string', content: 'hello', encrypted: false, version: '00'}
        );
      });

      test('Event with binary annotation is decoded correctly', async () => {
        const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
        return testEventDecoding(
          '0x0001' + buf2hex(binaryData.buffer).slice(2),
          {type: 'hex', content: buf2hex(binaryData.buffer), encrypted: false, version: '00'}
        );
      });

      test('Event with encrypted string annotation is decoded correctly', async () => {
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const encryptedData = await aesgcmEncrypt(sampleHash, nonce, encodeUTF16BE("hello"));
        return testEventDecoding(
          '0x0080' + buf2hex(nonce).slice(2) + buf2hex(encryptedData).slice(2),
          {type: 'string', content: 'hello', encrypted: true, version: '00'}
        );
      });

      test('Event with encrypted binary annotation is decoded correctly', async () => {
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const binaryData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
        const encryptedData = await aesgcmEncrypt(sampleHash, nonce, binaryData);
        return testEventDecoding(
          '0x0081' + buf2hex(nonce).slice(2) + buf2hex(encryptedData).slice(2),
          {type: 'hex', content: buf2hex(binaryData.buffer), encrypted: true, version: '00'}
        );
      });

      test('Multiple events are decoded correctly', async () => {
        const doc = new opensig.Document(mockNetwork, sampleHash);
        const signer1 = ethers.Wallet.createRandom().address;
        const signer2 = ethers.Wallet.createRandom().address;
        const signer3 = ethers.Wallet.createRandom().address;
        const annotations = ["Alice", "Bob", "Charlie"];
        const inputEvents = [
          [123, signer1, hashChain[0], '0x0000' + buf2hex(encodeUTF16BE(annotations[0])).slice(2)],
          [456, signer2, hashChain[1], '0x0000' + buf2hex(encodeUTF16BE(annotations[1])).slice(2)],
          [789, signer3, hashChain[2], '0x0000' + buf2hex(encodeUTF16BE(annotations[2])).slice(2)]
        ];
        const events = constructSimulatedEvents(inputEvents);
        mockNetwork.querySignatures.mockResolvedValueOnce(events);
        const signatures = await doc.verify();
        expect(signatures.length).toBe(3);
        for (let i = 0; i < 3; i++) {
          expect(signatures[i].time).toBe(inputEvents[i][0]);
          expect(signatures[i].signatory).toBe(inputEvents[i][1]);
          expect(signatures[i].signature).toBe(inputEvents[i][2]);
          expect(signatures[i].data).toMatchObject({type: 'string', content: annotations[i], encrypted: false, version: '00'});
        }
      });

    });  // End of Signature event decoding

  });  // End of Blockchain signature events

});

