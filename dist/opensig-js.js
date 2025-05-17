var opensig = (function (exports, ethers) {
  'use strict';

  // Copyright (c) 2023 Bubble Protocol

  const defaultABI = [ { anonymous: false, inputs: [ { indexed: false, internalType: "uint256", name: "time", type: "uint256" }, { indexed: true, internalType: "address", name: "signer", type: "address" }, { indexed: true, internalType: "bytes32", name: "signature", type: "bytes32" }, { indexed: false, internalType: "bytes", name: "data", type: "bytes" } ], name: "Signature", type: "event" }, { inputs: [ { internalType: "bytes32", name: "sig_", type: "bytes32" } ], name: "isRegistered", outputs: [ { internalType: "bool", name: "", type: "bool" } ], stateMutability: "view", type: "function" }, { inputs: [ { internalType: "bytes32", name: "sig_", type: "bytes32" }, { internalType: "bytes", name: "data_", type: "bytes" } ], name: "registerSignature", outputs: [], stateMutability: "nonpayable", type: "function" } ];


  /**
   * Abstract base class for all provider types.
   */
  class BlockchainProvider {

    /**
     * @param {string} params.name - Name of the provider
     * @param {string} params.chainId - Chain ID of the blockchain
     * @param {string} params.contract - Address of the OpenSig Registry contract on this chain
     * @param {number} params.blockTime - Average block time for this chain in milliseconds
     * @param {number} params.creationBlock? - Block number of the registry contract creation
     * @param {number} params.networkLatency? - Average latency for this network to distribute a published transaction
     */
    constructor(params) {
      this.params = params;
      this.name = params.name;
      this.chainId = params.chainId;
      this.contract = params.contract;
      this.blockTime = params.blockTime || 12000;
      this.fromBlock = params.creationBlock;
      this.abi = defaultABI;
      this.networkLatency = params.networkLatency;
    }

    /**
     * Publishes a signature and optional annotation data to the blockchain.
     * 
     * @param {string} signature 32-byte signature hash as a hex string with '0x' prefix.
     * @param {Uint8Array} data to annotate the signature
     * @returns Promise to resolve when published (not confirmed).  Rejects if the user cancels
     * or there is a problem publishing the signature.  Resolves with:
     *   {
     *     txHash: hash of the published transaction
     *     signatory: signer's address
     *     signature: the signature passed to this function
     *     data: the data passed to this function
     *     confirmationInformer: promise to resolve the txn receipt when the txn is confirmed
     *   } 
     */
    publishSignature(signature, data) {
      throw new Error('This is an abstract function and must be overridden')
    }

    /**
     * Queries the blockchain for a list of signatures that match those in the given list of 
     * signature hashes.
     * 
     * @param {[string]} ids array of signature hashes, each a 32-byte hex-string prefixed by '0x'
     * @returns Promise to resolve an array of signature event objects as defined by eth_getLogs.  
     * Rejects if the blockchain cannot be reached.
     */
    querySignatures(ids) {
      throw new Error('This is an abstract function and must be overridden')
    }

  }


  /**
   * Provider that uses ethers.js to publish and query signatures.
   * 
   * @param {Object} params - @see BlockchainProvider
   * @param {ethers.Provider} params.provider? - ethers.js provider to use for transactions and logs
   * @param {ethers.Provider} params.transactionProvider? - ethers.js provider to use for transactions (required if provider not given)
   * @param {ethers.Provider} params.logProvider? - ethers.js provider to use for logs (required if provider not given)
   */
  class EthersProvider extends BlockchainProvider {

    constructor(params) {
      super(params);
      this.transactionProvider = params.transactionProvider || params.provider;
      this.logProvider = params.logProvider || params.provider;
    }

    async querySignatures(ids) {
      const filter = {
        address: this.contract,
        fromBlock: this.fromBlock,
        topics: [null, null, ids],
      };
      return this.logProvider.send('eth_getLogs', [filter]);
    }
    
    async publishSignature(signature, data) {
      const signer = await this.transactionProvider.getSigner();
      const signatory = await signer.getAddress();
      const contract = new ethers.ethers.Contract(this.contract, this.abi, signer);
      const tx = await contract.registerSignature(signature, data);
      const receiptPromise = _awaitTransactionConfirmation(tx.hash, this.transactionProvider, this.blockTime, this.networkLatency);
      return {
        txHash: tx.hash,
        signatory,
        signature,
        data,
        confirmationInformer: receiptPromise
      };
    }

  }


  /**
   * @deprecated Use `EthersProvider` instead and pass a `BrowserProvider`.
   * 
   * Provider that uses a browser-installed wallet to publish and query signatures from the 
   * blockchain.
   */
  class MetamaskProvider extends EthersProvider{

    constructor(params) {
      const ethereum = params.ethereum || window.ethereum;
      if (!ethereum) throw new Error('A browser wallet, such as Metamask, must be installed');
      const provider = new ethers.ethers.BrowserProvider(ethereum);
      if (!provider) throw new Error('A browser wallet, such as Metamask, must be installed');
      super({...params, provider });
    }

  }


  /**
   * @deprecated Use `EthersProvider` instead and pass a `JsonRpcProvider`.
   * 
   * Provider that uses an external HTTP RPC to query signatures from the blockchain.
   */
  class HTTPProvider extends MetamaskProvider {

    constructor(params) {
      const logProvider = new ethers.ethers.JsonRpcProvider(params.url);
      super({...params, logProvider});
    }

  }


  /**
   * @deprecated Use `EthersProvider` instead and pass an `AnkrProvider`.
   * 
   * Provider that uses an Ankr HTTP RPC endpoint to query signatures from the blockchain.
   */
  class AnkrProvider extends MetamaskProvider {

    constructor(params) {
      const logProvider = new ethers.ethers.AnkrProvider(params.chainId, params.apiKey);
      super({...params, logProvider});
    }

  }


  const providers = {
    BlockchainProvider,
    EthersProvider,
    MetamaskProvider,
    HTTPProvider,
    AnkrProvider
  };


  //
  // Blockchain functions
  //


  /**
   * _awaitTransactionConfirmation
   * 
   * Returns a promise to resolve with the receipt when the given transaction hash has been confirmed by the blockchain network.
   * Rejects if the transaction reverted.
   * If the networkLatency parameter has been given then it includes that delay before resolving.  This is useful when different
   * RPC nodes are used for publishing and querying.  Gives time for the transaction to spread through the network.
   */
  function _awaitTransactionConfirmation(txHash, provider, blockTime, networkLatency=0) {
    return new Promise( (resolve, reject) => {

      function checkTxReceipt(txHash, interval, resolve, reject) {
        return provider.getTransactionReceipt(txHash)
          .then(receipt => {
            if (receipt === null ) setTimeout(() => { checkTxReceipt(txHash, interval, resolve, reject); }, interval);
            else {
              if (receipt.status) networkLatency > 0 ? setTimeout(() => resolve(receipt), networkLatency) : resolve(receipt);
              else reject(receipt);
            }
          })
          .catch(reject)
      }
      
      setTimeout(() => { checkTxReceipt(txHash, 1000, resolve, reject); }, blockTime || 1000); 
    })
  }

  // Copyright (c) 2023 Bubble Protocol
  // Distributed under the MIT software license, see the accompanying
  // file LICENSE or http://www.opensource.org/licenses/mit-license.php.

  //
  // General utility functions
  //


  function readFile(file) {
    return new Promise( (resolve, reject) => {
      var reader = new FileReader();
      reader.onload = () => { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    })
  }


  function buf2hex(buffer, prefix0x=true) {
    return (prefix0x ? '0x' : '')+[...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
  }


  function hexToBuf(hex) {
    return Uint8Array.from(hex.replace('0x','').match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
  }


  function concatBuffers(buffer1, buffer2) {
    var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
  }


  function unicodeStrToHex(str) {
    var result = "";
    for (let i=0; i<str.length; i++) {
      const hex = str.charCodeAt(i).toString(16);
      result += ("000"+hex).slice(-4);
    }
    return result
  }


  function unicodeHexToStr(str) {
    var hexChars = str.replace('0x','').match(/.{1,4}/g) || [];
    var result = "";
    for(let j = 0; j<hexChars.length; j++) {
      result += String.fromCharCode(parseInt(hexChars[j], 16));
    }
    return result;
  }

  // Copyright (c) 2023 Bubble Protocol


  //
  // Platform agnostic cryptographic functions
  //


  /**
   * Hashes the given data buffer
   * 
   * @param {Buffer} data 
   * @returns 32-byte hash as ArrayBuffer
   */
  function hash(data) {
    return _getSubtleCrypto().digest('SHA-256', data);
  }


  /**
   * Hashes the given File
   * 
   * @param {File} file the file to hash
   * @returns 32-byte hash as ArrayBuffer
   */
  async function hashFile(file) {
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
  class EncryptionKey {
    
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

  // Copyright (c) 2023 Bubble Protocol

  const SignatureEvent = new ethers.ethers.Interface([
    "event Signature(uint256 time, address indexed signer, bytes32 indexed signature, bytes data)"
  ]);

  /**
   * opensig.js
   * 
   * Core opensig browser library for signing and verifying documents and files on supported 
   * blockchains.
   * 
   * Requires blockchains.js
   */


  /**
   * Set the log trace level for debugging.  Call setLogTrace() to enable or disable logging.
   */
  let logTrace;
  setLogTrace(false);

  function setLogTrace(traceOn) {
    logTrace = traceOn ? Function.prototype.bind.call(console.info, console, "[opensig]") : function() {};
  }


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
  class Document {

    documentHash = undefined;
    encryptionKey = undefined;
    hashes = undefined;
    signingInProgress = false;

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
      if (this.signingInProgress) throw new Error("Signing already in progress");
      if (this.hashes === undefined) throw new Error("Must verify before signing");
      this.signingInProgress = true;
      return this.hashes.next()
        .then(signature => { 
          return _publishSignature(this.network, signature, data, this.encryptionKey);
        })
        .catch(error => {
          this.hashes.reset(this.hashes.currentIndex()-1);
          throw error;
        })
        .finally(() => {
          this.signingInProgress = false;
        });
    }

    /**
     * Retrieves all signatures on the blockchain for this Document.
     * 
     * @returns Array of signature events or empty array if none
     * @throws BlockchainNotSupportedError
     */
    async verify() {
      logTrace("verifying hash", buf2hex(this.documentHash));
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
  class File extends Document {

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
      logTrace("verifying file", this.file.name);
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
        logTrace("publishing signature:", signature, "with data", encodedData);
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
    const hashes = new HashIterator(documentHash, network.chainId);
    let lastSignatureIndex = -1;

    async function _discoverNext(n) {
      const eSigs = await hashes.next(n);
      const strEsigs = eSigs.map(s => {return buf2hex(s)});
      logTrace("querying the blockchain for signatures: ", strEsigs);

      return network.querySignatures(strEsigs)
        .then(events => {
          logTrace("found events:", events);
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
    const log = SignatureEvent.parseLog(event);
    if (!log) return {time: 0, signatory: '', signature: '', data: {type: 'none'}};
    return {
      event,
      time: Number(log.args[0]),
      signatory: log.args[1],
      signature: log.args[2],
      data: await _decodeData(log.args[3], encryptionKey)
    }
  }


  //
  // Signature Data encoders - encode and decode signature data in accordance with OpenSig standard v0.1
  //

  async function _encodeData(data, encryptionKey) {
    if (data.content === undefined || data.content === '') return '0x';
    if (data.encrypted && typeof data.encrypted !== 'boolean') throw new Error("invalid data encrypted flag");
    let type = data.encrypted ? SIG_DATA_ENCRYPTED_FLAG : 0;
    let encData = '';

    switch (data.type) {
      case 'string':
        if (typeof data.content !== 'string') throw new Error("invalid data content");
        type += SIG_DATA_TYPE_STRING;
        encData = unicodeStrToHex(data.content);
        break;

      case 'hex':
        if (typeof data.content !== 'string' || ethers.ethers.isHexString(data.content) === false) {
          throw new Error("invalid data content");
        }
        type += SIG_DATA_TYPE_BYTES;
        encData = data.content.slice(0,2) === '0x' ? data.content.slice(2) : data.content;
        break;

      default:
        throw new Error("invalid data type '"+data.type+"'");
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
    if (!encData || encData === '' || encData === '0x') return {type: 'none'};
    if (encData.length < 6) return {type: "invalid", content: "data is < 6 bytes"}
    const version = encData.slice(2,4);
    const typeField = parseInt(encData.slice(4,6), 16);
    const encrypted = typeField & SIG_DATA_ENCRYPTED_FLAG ? true : false;
    const type = typeField & ~SIG_DATA_ENCRYPTED_FLAG;
    const data = {
      version: version,
      encrypted: encrypted
    };
    
    let sigData = encData.slice(6);
    if (encrypted && sigData.length > 0) {
      try {
        sigData = await encryptionKey.decrypt(sigData);
      }
      catch(error) {
        logTrace("failed to decrypt signature data:", error.message);
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
        data.content = '0x'+sigData;
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
   * The core of OpenSig.  Generates the deterministic sequence of chain-specific signature hashes
   * from a document hash in accordance with OpenSig standard v0.1.  Use `next` to retrieve the next 
   * `n` hashes.  The iterator will only generate hashes when the `next` function is called.
   */
  class HashIterator {

    hashes = [];
    hashPtr = -1;

    constructor(documentHash, chainId) {
      this.documentHash = documentHash;
      this.chainId = chainId;
    }

    async next(n=1) {
      if (!this.chainSpecificHash) this.chainSpecificHash = await hash(concatBuffers(Uint8Array.from(''+this.chainId), this.documentHash));
      if (this.hashes.length === 0) this.hashes.push(await hash(this.chainSpecificHash));
      for (let i=this.hashes.length; i<=this.hashPtr+n; i++) {
        this.hashes.push(await hash(concatBuffers(this.chainSpecificHash, this.hashes[i-1])));
      }
      return this.hashes.slice(this.hashPtr+1, (this.hashPtr+=n)+1);
    }

    current() { return this.hashPtr >= 0 ? this.hashes[this.hashPtr] : undefined }

    currentIndex() { return this.hashPtr }

    indexAt(i) { return i < this.hashes.length ? this.hashes[i] : undefined }

    indexOf(hash) { return this.hashes.map(h => { return buf2hex(h) }).indexOf(hash) }

    reset(n=0) { this.hashPtr = n; }

    size() { return this.hashPtr+1 }

  }

  // Copyright (c) 2023 Bubble Protocol
  // Distributed under the MIT software license, see the accompanying
  // file LICENSE or http://www.opensource.org/licenses/mit-license.php.

  //
  // OpenSig-specific error typess
  //

  class BlockchainNotSupportedError extends Error {
    constructor() {
      super("Blockchain not supported");
    }
  }

  exports.BlockchainNotSupportedError = BlockchainNotSupportedError;
  exports.Document = Document;
  exports.File = File;
  exports.providers = providers;

  return exports;

})({}, ethers);
