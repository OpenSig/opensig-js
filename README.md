# opensig-js

Javascript e-signature library for digitally signing and verifying files on EVM-based blockchains using the OpenSig standard.  See https://opensig.net/about.  

Also supports public and private message notarisation to the blockchain.

## Usage

OpenSig notarises signatures on the blockchain via the [OpenSig Registry smart contract](./contracts/OpensigRegistry.sol). Registries are available on most major blockchains - see https://opensig.net/about#contracts for their addresses. To inform us of new public registries please contact [contribute@opensig.net](mailto:contribute@opensig.net).

### Node.js / React

#### Installation
```
npm install opensig-js
```

#### Use
```javascript
import * as opensig from 'opensig-js';

// Construct a blockchain provider (see Blockchain Providers section below)

const provider = new opensig.providers.EthersProvider({
  chainId: 1,
  name: "Ethereum",
  contract: "0x73eF7A3643aCbC3D616Bd5f7Ee5153Aa5f14DB30",
  blockTime: 12000,
  creationBlock: 16764681,
  provider: new ethers.JsonRpcProvider("https://mainnet.infura.io/v3/<YOUR-API-KEY>") // example provider
});

// Construct an OpenSig Document object from a File 
// (or construct one from a hash - see Document Class below)

const myDoc = new opensig.File(provider, new File('./myfile.txt'));

// Verify signatures on the blockchain

const signatures = await myDoc.verify();

signatures.forEach(sig => console.log(sig.time, sig.signatory, sig.data));


// Sign a document. 
// NB: You must `verify()` a document at least once before signing. This brings the object's
// signature chain up to date with the blockchain. See https://opensig.net/about for 
// information about how and why OpenSig chains signatures.

const signData = {
  type: 'string',
  encrypted: true,
  content: 'some data'
};

const result = await myDoc.sign(signData);

console.log(result.txHash, result.signatory, result.signature);

const receipt = await result.confirmationInformer;

console.log('signature published successfully', receipt));
```

### HTML

```html
<script src="https://cdn.jsdelivr.net/npm/opensig-js@0.1.5/dist/opensig-js.js"></script>
<script>
  const opensig = window.opensig;

  const provider = new opensig.providers.EthersProvider({
    chainId: 1,
    name: "Ethereum",
    contract: "0x73eF7A3643aCbC3D616Bd5f7Ee5153Aa5f14DB30",
    blockTime: 12000,
    creationBlock: 16764681,
    provider: new ethers.BrowserProvider() // example provider
  });

  ... // see Node.js usage above
</script>
```

## Document Class

The `Document` class is an alternative to the `File` class.  It takes a pre-determined document hash instead of a file.

```javascript
const myDocHash = "0x..."; // 32-byte hash

const myDoc = new opensig.Document(provider, myDocHash);

const signatures = await myDoc.verify();
...

```

## Blockchain Providers

OpenSig blockchain providers publish signature transactions to the blockchain and query the blockchain for signature events.

The bundled `EthersProvider` should be sufficient for most purposes, however you are free to implement your own.  See [src/providers.js](src/providers.js) for the `BlockchainProvider` interface.

### EthersProvider

An `EthersProvider` publishes and verifies signatures using `ethers-js` built in [Provider](https://docs.ethers.org/v6/api/providers/) instances. 

This allows OpenSig to be used with browser-installed wallets, RPC providers and community providers like Ankr and Infura (see [ethers community providers](https://docs.ethers.org/v6/api/providers/thirdparty/)).

The `EthersProvider` class takes a `provider` constructor parameter. The provider will be used for both publishing signatures and reading signature event logs. Alternatively, use the `transactionProvider` and `logProvider` parameters to set different providers for publishing to and reading from the blockchain.

### Parameters

`EthersProvider` takes the following constructor parameters:

  - `chainId: number` - blockchain's chain id
  - `name: string` - (optional) label
  - `contract: string` - address of that blockchain's Registry Contract (see https://opensig.net/about#contracts)
  - `blockTime: number` - the network block time in ms
  - `creationBlock: number` - (optional) the registry contract's creation block number (minimises search window when querying for signatures)
  - `networkLatency: number` - (optional) average time for a mined transaction to be consumed by the network (helps to prevent race conditions when verifying soon after publishing)
  - `provider: ethers.Provider` - (not required if both `transactionProvider` and `logProvider` are given) ethers-js provider used for both publishing to and reading from the blockchain
  - `transactionProvider: ethers.Provider` - (optional, overrides any `provider`) ethers-js provider used for publishing signatures to the blockchain
  - `logProvider: ethers.Provider` - (optional, overrides any `provider`) ethers-js provider used for reading signature event logs from the blockchain

### Examples

```javascript
// Ethereum Mainnet provider using browser-installed wallet
const ethereumProvider = new opensig.providers.EthersProvider({
  chainId: 1,
  name: "Ethereum",
  contract: "0x73eF7A3643aCbC3D616Bd5f7Ee5153Aa5f14DB30", 
  blockTime: 12000,
  creationBlock: 16764681,
  provider: new ethers.BrowserProvider(window.ethereum)
})

// Polygon mainnet provider using a custom RPC provider
const polygonProvider = new opensig.providers.EthersProvider({
  chainId: 137,
  name: "Polygon",
  contract: "0x4037E81D79aD0E917De012dE009ff41c740BB453",
  blockTime: 2000,
  creationBlock: 40031474,
  provider: new ethers.JsonRpcProvider("https://my.rpc.endpoint.com")
})

// Binance Smart Chain provider using a QuickNode provider and a 5s network latency
const bnbProvider = new opensig.providers.EthersProvider({
  chainId: 56,
  name: "Binance Smart Chain",
  contract: "0xF6656646ECf7bD4100ec0014163F6CaD44eA1715",
  blockTime: 3000,
  creationBlock: 26229027,
  networkLatency: 5000,
  provider: new ethers.QuickNodeProvider(56, "MY_API_TOKEN")
})

// Avalanche mainnet provider using the browser-installed wallet for signing and 
// an Ankr provider for verifying
const avaxProvider = new opensig.providers.EthersProvider({
  chainId: 43114,
  name: "Avalanche",
  contract: "0xF6656646ECf7bD4100ec0014163F6CaD44eA1715",
  blockTime: 2000,
  creationBlock: 27645459,
  networkLatency: 5000,
  transactionProvider: new ethers.BrowserProvider(window.ethereum),
  logProvider: new ethers.AnkrProvider(43114, "MY_API_KEY")
})
```

## Testing

This project uses [Jest](https://jestjs.io/) for unit test.

```bash
npm test
```

## Contributing

Contributions are welcome. To submit a pull request:

1. Fork the repository

2. Create a new branch (git checkout -b feature/my-feature)

3. Make your changes and add tests if needed

4. Run the test suite with npm test

5. Submit a pull request

Please keep your changes focused and well-documented. Thanks for helping improve the project!

## Support

If you'd like to report a bug or suggest a feature then please open an issue in the Github repository.

For usage or any other support please contact [support@opensig.net](mailto:support@opensig.net).

## License

MIT License (including all dependencies)