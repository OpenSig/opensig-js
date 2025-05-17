// Copyright (c) 2023 Bubble Protocol
// Distributed under the MIT software license, see the accompanying
// file LICENSE or http://www.opensource.org/licenses/mit-license.php.

//
// Providers - supports external HTTP RPC providers and Metamask.
//

import { ethers } from "ethers";

const defaultABI = [ { anonymous: false, inputs: [ { indexed: false, internalType: "uint256", name: "time", type: "uint256" }, { indexed: true, internalType: "address", name: "signer", type: "address" }, { indexed: true, internalType: "bytes32", name: "signature", type: "bytes32" }, { indexed: false, internalType: "bytes", name: "data", type: "bytes" } ], name: "Signature", type: "event" }, { inputs: [ { internalType: "bytes32", name: "sig_", type: "bytes32" } ], name: "isRegistered", outputs: [ { internalType: "bool", name: "", type: "bool" } ], stateMutability: "view", type: "function" }, { inputs: [ { internalType: "bytes32", name: "sig_", type: "bytes32" }, { internalType: "bytes", name: "data_", type: "bytes" } ], name: "registerSignature", outputs: [], stateMutability: "nonpayable", type: "function" } ];


/**
 * Abstract base class for all provider types.
 */
export class BlockchainProvider {

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
export class EthersProvider extends BlockchainProvider {

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
    const contract = new ethers.Contract(this.contract, this.abi, signer);
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
export class MetamaskProvider extends EthersProvider{

  constructor(params) {
    const ethereum = params.ethereum || window.ethereum;
    if (!ethereum) throw new Error('A browser wallet, such as Metamask, must be installed');
    const provider = new ethers.BrowserProvider(ethereum);
    if (!provider) throw new Error('A browser wallet, such as Metamask, must be installed');
    super({...params, provider });
  }

}


/**
 * @deprecated Use `EthersProvider` instead and pass a `JsonRpcProvider`.
 * 
 * Provider that uses an external HTTP RPC to query signatures from the blockchain.
 */
export class HTTPProvider extends MetamaskProvider {

  constructor(params) {
    const logProvider = new ethers.JsonRpcProvider(params.url);
    super({...params, logProvider});
  }

}


/**
 * @deprecated Use `EthersProvider` instead and pass an `AnkrProvider`.
 * 
 * Provider that uses an Ankr HTTP RPC endpoint to query signatures from the blockchain.
 */
export class AnkrProvider extends MetamaskProvider {

  constructor(params) {
    const logProvider = new ethers.AnkrProvider(params.chainId, params.apiKey);
    super({...params, logProvider});
  }

}


export const providers = {
  BlockchainProvider,
  EthersProvider,
  MetamaskProvider,
  HTTPProvider,
  AnkrProvider
}


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
          if (receipt === null ) setTimeout(() => { checkTxReceipt(txHash, interval, resolve, reject) }, interval);
          else {
            if (receipt.status) networkLatency > 0 ? setTimeout(() => resolve(receipt), networkLatency) : resolve(receipt);
            else reject(receipt);
          }
        })
        .catch(reject)
    }
    
    setTimeout(() => { checkTxReceipt(txHash, 1000, resolve, reject) }, blockTime || 1000); 
  })
}

