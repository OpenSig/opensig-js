# opensig-js

Javascript library for digitally signing and verifying files on EVM-based blockchains using the OpenSig standard.  See https://opensig.net/about.

## Installation

```
npm install opensig-js
```

## Usage

```
import * as opensig from 'opensig-js';


// Construct a blockchain provider (see opensig.providers)

const provider = new opensig.providers.MetamaskProvider({
  chainId: 1,
  name: "Ethereum",
  contract: "0x73eF7A3643aCbC3D616Bd5f7Ee5153Aa5f14DB30", 
  blockTime: 12000,
  creationBlock: 16764681
});


// Construct an OpenSig Document object

const myDoc = new opensig.File(provider, new File('./myfile.txt'));


// Verify signatures on the blockchain

const signatures = myDoc.verify();

signatures.forEach(sig => console.log(sig.time, sig.signatory, sig.data));


// Sign using Metamask

const signData = {
  type: 'string',
  encrypted: true,
  content: 'some data'
};

const result = myDoc.sign(signData);

console.log(result.txHash, result.signatory, result.signature);

result.confirmationInformer
  .then(receipt => console.log('signature published successfully', receipt))
  .catch(console.error)
```

### Document Class

The `Document` class is an alternative to the `File` class.  It takes a pre-determined document hash instead of a file.

```
const myDocHash = ...

const myDoc = new opensig.Document(provider, myDocHash);

const signatures = myDoc.verify();
...

```

### Blockchain Providers

Blockchain providers publish sign transactions to the blockchain and query the blockchain for signatures using whatever transport protocol is appropriate.

Implement your own or use one of the bundled providers.  See [src/providers.js](src/providers.js) for the BlockchainProvider interface.

OpenSig is bundled with 3 types of provider accessed via `opensig.providers`.  At this time all three use Metamask to sign signature transactions but use different services to query the blockchain for signatures:

**MetamaskProvider** - Uses the local Metamask wallet to query the blockchain for signatures and to sign transactions.

**HTTPProvider** - Uses a web3 http provider to query the blockchain for signatures.  Uses the local Metamask wallet to sign and publish transactions.

**AnkrProvider** - Uses the Ankr network to query the blockchain for signatures.  Uses the local Metamask wallet to sign and publish transactions.

