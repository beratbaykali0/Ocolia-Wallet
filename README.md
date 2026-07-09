# Ocolia Wallet

by Berat BAYKALI

A multi-chain cryptocurrency wallet browser extension (Manifest V3) for **Bitcoin**, **Ethereum**, and **Solana**.

## Features

- Create or import a wallet from a BIP39 seed phrase (12 / 24 words)
- BTC, ETH and SOL address generation, balance fetching and transaction sending
- Copy receive addresses
- Optional password protection for the stored seed (PBKDF2-SHA256 + AES-GCM)
- Per-chain address validation before sending
- Dynamic Bitcoin fee estimation (no hardcoded fee)
- Transaction history (sent transactions) stored locally per chain
- Side panel support (Chrome 114+ and Microsoft Edge)

## Derivation paths

| Chain   | Path                     | Scheme        |
|---------|--------------------------|---------------|
| BTC     | `m/44'/0'/0'/0/0`        | Legacy P2PKH  |
| ETH     | `m/44'/60'/0'/0/0`       | EIP-55        |
| SOL     | `m/44'/501'/0'/0'`       | Ed25519 (SLIP-0010, derived with Web Crypto HMAC-SHA512) |

## Security model

- The seed phrase is the wallet. It is stored in `chrome.storage.local`.
- On wallet creation/import you are asked to set a password:
  - **With a password** (minimum 8 characters): the seed is encrypted with
    AES-GCM using a key derived from your password via PBKDF2-SHA256
    (600,000 iterations). The encrypted vault is stored on disk; the key is
    **never** stored. On each unlock the key is re-derived from your password.
  - **Without a password** ("Continue without password"): the seed is stored
    **unencrypted (plaintext)** on the device. Choose this only if you
    understand the risk — anyone with access to the browser profile can read it.
- "Exit" forgets the wallet entirely (seed is removed from storage) and returns
  to the create/import screen. There is no recovery from storage if you did not
  back up your seed phrase.
- Locking the wallet requires the password again (when one is set).

## Data sources (public APIs)

- Bitcoin balance: `blockchain.info`
- Bitcoin UTXOs / fee estimate / broadcast: `blockcypher.com`
- Ethereum RPC: `ethereum-rpc.publicnode.com`
- Solana RPC: `solana-rpc.publicnode.com`
- Prices (USD): `api.coingecko.com`

## Build

The crypto libraries are bundled locally into `libs/bundle.js` so the extension
works offline (no CDN dependencies). To rebuild the bundle:

```
.\build-libs.ps1
```

This installs the dependencies into `libs/node_modules` (if missing) and bundles
them with [esbuild](https://esbuild.github.io/). Notes:

- `libs/entry.js` exposes the libraries as `window.*` globals used by `popup.js`.
- `libs/inject.js` is an **esbuild `--inject` helper** (not a runtime script); it
  provides the `Buffer` global to the bundled libraries. Do not load it via
  `<script>` or `manifest.json`.
- The Solana ed25519 seed is derived in `popup.js` itself (Web Crypto), so
  `@noble/curves` is **not** a dependency.

## Load the extension

1. Build the bundle (see above) or use the committed `libs/bundle.js`.
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**.
3. Click **Load unpacked** and select this project folder.
4. Click the extension icon, or open it from the side panel.

## Disclaimer

This is an open-source project and is not recommended for professional use. For professional use, we recommend Phantom or MetaMask. We are not responsible for any financial losses or errors that may occur.

Source code: https://github.com/beratbaykali0/Ocalia-Wallet

This project was developed with the assistance of artificial intelligence by Berat BAYKALI.
