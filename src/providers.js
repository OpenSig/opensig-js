// Copyright (c) 2023 Bubble Protocol
// Distributed under the MIT software license, see the accompanying
// file LICENSE or http://www.opensource.org/licenses/mit-license.php.

/**
 * blockchains.js
 * 
 * Configuration for blockchains supported by the core OpenSig library.
 * 
 * Use getBlockchain() to obtain the blockchain configuration object for the chain currently
 * selected in Metamask, or use getBlockchain(<chainId>) for a specific chain.
 * 
 * A blockchain configuration object is defined as:
 *   {
 *     chainId: <numeric chain id>
 *     name: <string name of the chain>
 *     Provider: {
 *       publishSignature(hash, data) <publishes a signature hash and data to the blockchain>
 *       querySignatures() <queries the blockchain for a list of signature hashes>
 *     }
 *   }
 * 
 * Requires Metamask.
 */


//
// Providers - supports external HTTP RPC providers and Metamask.
//

/**
 * Abstract base class for all provider types.  A Provider allows signatures to be published to
 * and queried from a blockchain using whatever RPC service it needs.
 * 
 * Metamask is used to sign and publish signature transactions for all blockchains.  Child classes
 * must implement querySignatures to retrieve signature events from the blockchain using their
 * preferred service.
 */
export class BlockchainProvider {

  constructor(params) {
    this.name = params.name;
    this.chainId = params.chainId;
    this.contract = params.contract;
    this.fromBlock = params.creationBlock;
    this.abi = params.abi;
    this.blockTime = params.blockTime;
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
    const web3 = _getBrowserWeb3();
    const signatory = window.ethereum.selectedAddress;
    const contract = new web3.eth.Contract(this.abi, this.contract);
    const transactionParameters = {
      to: this.contract,
      from: signatory,
      value: 0,
      data: contract.methods.registerSignature(signature, data).encodeABI()
    };
    return window.ethereum.request({ method: 'eth_sendTransaction', params: [transactionParameters] })
      .then(txHash => { 
        return { 
          txHash: txHash, 
          signatory: signatory,
          signature: signature,
          data: data,
          confirmationInformer: _awaitTransactionConfirmation(txHash, web3, this.blockTime, this.networkLatency) 
        };
      });
  }

  /**
   * Queries the blockchain for a list of signatures that match those in the given list of 
   * signature hashes.
   * 
   * @param {[string]} ids array of signature hashes, each a 32-byte hex-string prefixed by '0x'
   * @returns Promise to resolve an array of signature event objects as defined by eth_getLogs.  
   * Rejects if the blockchain cannot be reached.
   * 
   * @dev Override this function to use whatever service is needed for your blockchain.
   */
  querySignatures(ids) {
    throw new Error('This is an abstract function and must be overridden')
  }

}


/**
 * Provider that uses Metamask to query signatures from the blockchain.
 */
export class MetamaskProvider extends BlockchainProvider{

  querySignatures(ids) {
    const web3 = _getBrowserWeb3();
    return web3.eth.getPastLogs({
      address: this.contract,
      fromBlock: this.fromBlock,
      topics: [null, null, ids]
    });
  }
  
}


/**
 * Provider that uses an external HTTP RPC to query signatures from the blockchain.
 */
export class HTTPProvider extends BlockchainProvider {

  constructor(params) {
    super(params);
    this.web3 = new Web3(new Web3.providers.HttpProvider(params.url));
  }

  querySignatures(ids) {
    return this.web3.eth.getPastLogs({
      address: this.contract,
      fromBlock: this.fromBlock,
      topics: [null, null, ids]
    });
  }
  
}


/**
 * Provider that uses an Ankr HTTP RPC endpoint to query signatures from the blockchain.
 */
export class AnkrProvider extends BlockchainProvider {

  constructor(params) {
    super(params);
    this.endpoint = params.endpoint;
  }

  querySignatures(ids) {
    return fetch( this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "ankr_getLogs",
        params: {
          blockchain: this.blockchain,
          address: this.contract,
          fromBlock: this.fromBlock,
          topics: [null, null, ids]
        }
      })
    })
    .then(response => {
      if (response.status !== 200) throw new Error(response.status+": "+response.statusText);
      return response.json();
    })
    .then(response => {
      if (response.error && response.error.code) throw new Error(response.error.code+': '+response.error.message);
      if (!response.result || !response.result.logs) {
        console.error('Failed to query signatures at '+this.endpoint+': missing result logs in Ankr response');
        return [];
      }
      return response.result.logs;
    })
  }

}


export const providers = {
  BlockchainProvider: BlockchainProvider,
  MetamaskProvider: MetamaskProvider,
  HTTPProvider: HTTPProvider,
  AnkrProvider: AnkrProvider
}


//
// Blockchain functions
//

function _getBrowserWeb3() {
  if (typeof window.ethereum === 'undefined') throw new Error('Metamask is not installed');
  return new Web3(window.ethereum);
}


/**
 * _awaitTransactionConfirmation
 * 
 * Returns a promise to resolve with the receipt when the given transaction hash has been confirmed by the blockchain network.
 * Rejects if the transaction reverted.
 * If the networkLatency parameter has been given then it includes that delay before resolving.  This is useful when different
 * RPC nodes are used for publishing and querying.  Gives time for the transaction to spread through the network.
 */
function _awaitTransactionConfirmation(txHash, web3, blockTime, networkLatency=0) {
  return new Promise( (resolve, reject) => {

    function checkTxReceipt(txHash, interval, resolve, reject) {
      web3.eth.getTransactionReceipt(txHash)
        .then(receipt => {
          if (receipt === null ) setTimeout(() => { checkTxReceipt(txHash, interval, resolve, reject) }, interval);
          else {
            if (receipt.status) networkLatency > 0 ? setTimeout(() => resolve(receipt), networkLatency) : resolve(receipt);
            else reject(receipt);
          }
        })
    }
    
    setTimeout(() => { checkTxReceipt(txHash, 1000, resolve, reject) }, blockTime); 
  })
}

