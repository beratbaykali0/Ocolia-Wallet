const buffer = require('buffer');
const bip39 = require('bip39');
const { HDKey } = require('@scure/bip32');
const wif = require('wif');
const bitcoin = require('bitcoinjs-lib');
const ethers = require('ethers');
const solWeb3 = require('@solana/web3.js');

window.Buffer = buffer.Buffer || buffer;
window.bip39 = bip39;
window.bip32 = HDKey;
window.wif = wif;
window.bitcoin = bitcoin;
window.ethers = ethers;
window.solWeb3 = solWeb3;
