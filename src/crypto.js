// Copyright (c) 2023 Bubble Protocol
// Distributed under the MIT software license, see the accompanying
// file LICENSE or http://www.opensource.org/licenses/mit-license.php.

import { buf2hex, concatBuffers, hexToBuf, readFile } from "./utils";


//
// Platform agnostic cryptographic functions
//


/**
 * Hashes the given data buffer
 * 
 * @param {Buffer} data 
 * @returns 32-byte hash as ArrayBuffer
 */
export function hash(data) {
  return _getSubtleCrypto().digest('SHA-256', data);
}


/**
 * Hashes the given File
 * 
 * @param {File} file the file to hash
 * @returns 32-byte hash as ArrayBuffer
 */
export async function hashFile(file) {
  return readFile(file)
    .then(data => {
      return _getSubtleCrypto().digest('SHA-256', data);
    })
}


/**
 * An encryption key generated from a 32-byte hash.  Provides encrypt and decrypt methods.
 * 
 * @param {Buffer} hash 32-byte hash
 * @returns Promise to resolve the CryptoKey object 
 */
export class EncryptionKey {
  
  /**
   * Constructs an EncryptionKey from a 32-byte buffer
   * 
   * @param {Buffer} hash 32-byte hash
   * @returns Promise to resolve the CryptoKey object 
   */
  constructor(hash) {
    this.hash = hash;
  }

  /**
   * Encrypt some data.
   * 
   * @param {String} data hex string data to encrypt
   * @returns Promise to resolve encrypted data as a hex string
   */
  encrypt(data) {
    const iv = _getCrypto().getRandomValues(new Uint8Array(12));
    return this._getKey()
      .then(key => {
        return _getSubtleCrypto().encrypt({name: 'AES-GCM', iv: iv}, key, hexToBuf(data))
      })
      .then(data => {
        return buf2hex(concatBuffers(iv, data), false);
      })
  }

  /**
   * Decrypt some encrypted data.
   * 
   * @param {String} data hex string data to decrypt
   * @returns Promise to resolve decrypted data as a hex string
   */
  decrypt(data) {
    const buf = hexToBuf(data);
    return this._getKey()
      .then(key => {
        return _getSubtleCrypto().decrypt({name: 'AES-GCM', iv: buf.slice(0,12)}, key, buf.slice(12))
      })
      .then( data => {
        return buf2hex(data, false);
      });
  }

  async _getKey() {
    if (this.key) return Promise.resolve(this.key);
    else {
      return _getSubtleCrypto().importKey("raw", this.hash, {name: 'AES-GCM'}, true, ['encrypt', 'decrypt'])
        .then(key => {
          this.key = key;
          return key;
        })
    }
  }

}


/**
 * Platform agnostic SubtleCrypto 
 */

const _crypto = crypto || window.crypto || {};

function _getCrypto() {
  if (!_crypto.subtle) throw new Error("Missing crypto capability");
  return _crypto;
}

function _getSubtleCrypto() {
  return _getCrypto().subtle;
}

