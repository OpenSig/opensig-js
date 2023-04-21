// Copyright (c) 2023 Bubble Protocol
// Distributed under the MIT software license, see the accompanying
// file LICENSE or http://www.opensource.org/licenses/mit-license.php.

import { BlockchainProvider } from './providers.js';
import { EncryptionKey, hash, hashFile } from './crypto.js';
import { buf2hex, concatBuffers, unicodeStrToHex, unicodeHexToStr } from './utils.js';

/**
 * opensig.js
 * 
 * Core opensig browser library for signing and verifying documents and files on supported 
 * blockchains.
 * 
 * Requires blockchains.js
 */


 /** 
  * OpenSig Standard v0.1 constants
  */

const SIG_DATA_VERSION = '00';
const SIG_DATA_ENCRYPTED_FLAG = 128;
const SIG_DATA_TYPE_STRING = 0;
const SIG_DATA_TYPE_BYTES = 1;


/**
 * Maximum number of signatures to search for in each verification query
 */
const MAX_SIGS_PER_DISCOVERY_ITERATION = 10;


/**
 * Document class
 * 
 * Represents an OpenSig document - an object formed from a hash that can be signed and verified.
 * To use this class directly you must first hash your data.  Use the File class instead to 
 * construct a Document from a file.
 * 
 * Before a Document can be signed it must first be verified.  Verification returns the list of 
 * signatures for this Document found on the blockchain and establishes the next signature in 
 * the sequence ready for signing.
 */
export class Document {

  documentHash = undefined;
  encryptionKey = undefined;
  hashes = undefined;

  /**
   * Construct an OpenSig Document (an object formed from a document hash that can be signed and 
   * verified) from the given hash.
   * 
   * @param {BlockchainProvider} network the blockchain provider object
   * @param {Buffer} hash 32-byte hash of a file or document
   * @param {BlockchainProvider} network interface to the blockchain
   */
  constructor(network, hash) {
    this.network = network;
    this.sign = this.sign.bind(this);
    this.verify = this.verify.bind(this);
    this._setDocumentHash = this._setDocumentHash.bind(this);
    if (hash !== undefined) this._setDocumentHash(hash);
  }

  /**
   * Signs the document with the next available signature hash and the given data. The document
   * must have been verified using the `verify` function before signing.
   * 
   * @param {Object} data (optional) containing
   *    type: 'string'|'hex'
   *    encrypted: boolean. If true, opensig will encrypt the data using the document hash as the encryption key
   *    content: string containing either the text or hex content
   * @returns {Object} containing 
   *    txHash: blockchain transaction hash
   *    signatory: blockchain address of the signer
   *    signature: the signature hash published
   *    confirmationInformer: Promise to resolve with the receipt when the transaction has been confirmed
   * @throws BlockchainNotSupportedError
   */
  async sign(data = {}) {
    if (this.hashes === undefined) throw new Error("Must verify before signing");
    return this.hashes.next()
      .then(signature => { 
        return _publishSignature(this.network, signature, data, this.encryptionKey);
      })
      .catch(error => {
        this.hashes.reset(this.hashes.currentIndex()-1);
        throw error;
      });
  }

  /**
   * Retrieves all signatures on the blockchain for this Document.
   * 
   * @returns Array of signature events or empty array if none
   * @throws BlockchainNotSupportedError
   */
  async verify() {
    console.trace("verifying hash", buf2hex(this.documentHash));
    return _discoverSignatures(this.network, this.documentHash, this.encryptionKey)
      .then(result => {
        this.hashes = result.hashes;
        return result.signatures;
      });
  }

  _setDocumentHash(hash) {
    if (this.documentHash) throw new Error("document hash already initialised");
    this.documentHash = hash;
    this.encryptionKey = new EncryptionKey(hash);
  }

}


/**
 * Creates a Document from a file, allowing it to be signed and verified.
 */
export class File extends Document {

  file = undefined;
  document = undefined;

  /**
   * Construct an OpenSig Document (an object formed from a document hash that can be signed and
   * verified) from a File object.
   * 
   * @param {File} file the file to hash
   */
  constructor(network, file) {
    super(network, undefined);
    this.file = file;
  }

  /**
   * Retrieves all signatures on the current blockchain for this file.
   * 
   * @returns Array of signature events or empty array if none
   * @throws BlockchainNotSupportedError
   */
  async verify() {
    if (this.documentHash !== undefined) return super.verify();
    console.trace("verifying file", this.file.name);
    return hashFile(this.file)
      .then(this._setDocumentHash)
      .then(super.verify.bind(this));
  }

}



//
// Signing functions
//

/**
 * Constructs a transaction to publish the given signature transaction to the blockchain's registry contract.
 * Returns an object containing the transaction hash, signatory, signature, and a Promise to resolve when confirmed.
 */ 
function _publishSignature(network, signatureAsArr, data, encryptionKey) {
  const signature = buf2hex(signatureAsArr[0]);  
  return _encodeData(data, encryptionKey)
    .then(encodedData => {
      console.trace("publishing signature:", signature, "with data", encodedData);
      return network.publishSignature(signature, encodedData);
    });
}


//
// Verifying functions
//

/**
 * Queries the blockchain for signature events generated by the registry contract for the given document hash.
 * 
 * In the OpenSig Standard, signatures are a deterministic chain of hashes derived from the document hash and 
 * chain id.  This function queries the blockchain for signatures in the order of those in the chain of hashes,
 * stopping when a signature in the sequence is not not found.  To minimise latency while handling signature 
 * chains of any length, this function queries for signatures a batch at a time.
 */
async function _discoverSignatures(network, documentHash, encryptionKey) {
  const signatureEvents = [];
  const chainSpecificDocumentHash = await hash(concatBuffers(Uint8Array.from(''+network.chainId), documentHash))
  const hashes = new HashIterator(chainSpecificDocumentHash);
  let lastSignatureIndex = -1;

  async function _discoverNext(n) {
    const eSigs = await hashes.next(n);
    const strEsigs = eSigs.map(s => {return buf2hex(s)});
    console.trace("querying the blockchain for signatures: ", strEsigs);

    return network.querySignatures(strEsigs)
      .then(events => {
        console.trace("found events:", events);
        return Promise.all(events.map(e => _decodeSignatureEvent(e, encryptionKey)));
      })
      .then(parsedEvents => {
         signatureEvents.push(...parsedEvents);

        // update state index of most recent signature
        parsedEvents.forEach(e => {
          const sigNumber = hashes.indexOf(e.signature);
          if (sigNumber > lastSignatureIndex) lastSignatureIndex = sigNumber;
        });
        
        // discover more signatures if necessary
        if (parsedEvents.length !== MAX_SIGS_PER_DISCOVERY_ITERATION) {
          hashes.reset(lastSignatureIndex); // leave the iterator at the last published signature
          return { hashes: hashes, signatures: signatureEvents };
        }
        return _discoverNext(MAX_SIGS_PER_DISCOVERY_ITERATION);
      });

  }

  return _discoverNext(MAX_SIGS_PER_DISCOVERY_ITERATION);

}


/**
 * Transforms a blockchain signature event into an OpenSig signature object.  
 * Decrypts and decodes any annotation data.
 */
async function _decodeSignatureEvent(event, encryptionKey) {
  const web3 = new Web3(window.ethereum);
  const decodedEvent = web3.eth.abi.decodeLog(
    [ { "indexed": false, "internalType": "uint256", "name": "time", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "signer", "type": "address" }, { "indexed": true, "internalType": "bytes32", "name": "signature", "type": "bytes32" }, { "indexed": false, "internalType": "bytes", "name": "data", "type": "bytes" } ],
    event.data,
    event.topics.slice(1)
  )
  return {
    time: decodedEvent.time,
    signatory: decodedEvent.signer,
    signature: decodedEvent.signature,
    data: await _decodeData(decodedEvent.data, encryptionKey)
  }
}


//
// Signature Data encoders - encode and decode signature data in accordance with OpenSig standard v0.1
//

async function _encodeData(data, encryptionKey) {
  if (data.content === undefined || data.content === '') return '0x';
  let type = data.encrypted ? SIG_DATA_ENCRYPTED_FLAG : 0;
  let encData = '';

  switch (data.type) {
    case 'string':
      type += SIG_DATA_TYPE_STRING;
      encData = unicodeStrToHex(data.content);
      break;

    case 'hex':
      type += SIG_DATA_TYPE_BYTES;
      encData = data.content.slice(0,2) === '0x' ? data.content.slice(2) : data.content;
      break;

    default:
      throw new Error("encodeData: invalid type '"+data.type+"'");
  }

  const typeStr = ('00' + type.toString(16)).slice(-2);
  const prefix = '0x'+SIG_DATA_VERSION + typeStr;

  if (data.encrypted) {
    return encryptionKey.encrypt(encData)
      .then(encryptedData => { return '0x'+SIG_DATA_VERSION + typeStr + encryptedData });
  }
  else return prefix + encData;
}

async function _decodeData(encData, encryptionKey) {
  if (!encData || encData === '') return {type: 'none'}
  if (encData.length < 6) return {type: "invalid", content: "data is < 6 bytes"}
  const version = encData.slice(2,4);
  const typeField = parseInt(encData.slice(4,6), 16);
  const encrypted = typeField & SIG_DATA_ENCRYPTED_FLAG ? true : false;
  const type = typeField & ~SIG_DATA_ENCRYPTED_FLAG;
  const data = {
    version: version,
    encrypted: encrypted
  }
  
  let sigData = encData.slice(6);
  if (encrypted && sigData.length > 0) {
    try {
      sigData = await encryptionKey.decrypt(sigData);
    }
    catch(error) {
      console.trace("failed to decrypt signature data:", error.message);
      sigData = '';
    }
  }

  switch (type) {
    case SIG_DATA_TYPE_STRING:
      data.type = 'string';
      data.content = unicodeHexToStr(sigData);
      break;
    
    case SIG_DATA_TYPE_BYTES:
      data.type = 'hex';
      data.content = '0x'+sigData
      break;

    default:
      data.type = 'invalid';
      data.content = "unrecognised type: "+type+" (version="+version+")";
  }

  return data;
}



/**
 * HashIterator class
 * 
 * The primary way to calculate the sequence of signatures for a document hash.  Generates the 
 * deterministic sequence of chain-specific signature hashes for a document hash in accordance with 
 * OpenSig standard v0.1.  Use `next` to retrieve the next `n` hashes.  The iterator will only 
 * generate hashes when the `next` function is called.
 */
export class HashIterator {

  hashes = [];
  hashPtr = -1;

  constructor(documentHash) {
    this.documentHash = documentHash;
  }

  async next(n=1) {
    if (this.hashes.length === 0) this.hashes.push(await hash(this.documentHash));
    for (let i=this.hashes.length; i<=this.hashPtr+n; i++) {
      this.hashes.push(await hash(concatBuffers(this.documentHash, this.hashes[i-1])));
    }
    return this.hashes.slice(this.hashPtr+1, (this.hashPtr+=n)+1);
  }

  current() { return this.hashPtr >= 0 ? this.hashes(this.hashPtr) : undefined }

  currentIndex() { return this.hashPtr }

  indexAt(i) { return i < this.hashes.length ? this.hashes[i] : undefined }

  indexOf(hash) { return this.hashes.map(h => { return buf2hex(h) }).indexOf(hash) }

  reset(n=0) { this.hashPtr = n }

  size() { return this.hashPtr }

}


