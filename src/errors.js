// Copyright (c) 2023 Bubble Protocol
// Distributed under the MIT software license, see the accompanying
// file LICENSE or http://www.opensource.org/licenses/mit-license.php.

//
// OpenSig-specific error typess
//

export class BlockchainNotSupportedError extends Error {
  constructor() {
    super("Blockchain not supported");
  }
}

