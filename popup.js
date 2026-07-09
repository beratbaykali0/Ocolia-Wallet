// ---------- STATE ----------
let state = {
  mnemonic: '',
  wallets: {
    btc: { address: '', privateKey: '', balance: 0, pubkey: null, child: null },
    eth: { address: '', privateKey: '', balance: 0, wallet: null },
    sol: { address: '', privateKey: '', balance: 0, keypair: null },
  },
  activeChain: 'btc',
};

// ---------- DOM REFS ----------
const $ = (id) => document.getElementById(id);
const screenLoading = $('screen-loading');
const screenOnboard = $('screen-onboard');
const screenWallet = $('screen-wallet');
const modalMnemonic = $('modal-mnemonic');
const importArea = $('import-area');
const importMnemonic = $('import-mnemonic');
const importError = $('import-error');
const sendForm = $('send-form');
const sendTo = $('send-to');
const sendAmount = $('send-amount');
const sendError = $('send-error');
const sendSuccess = $('send-success');
const mnemonicDisplay = $('mnemonic-display');
const balanceDisplay = $('balance-display');
const currencyDisplay = $('currency-display');
const usdDisplay = $('usd-display');
const addressDisplay = $('address-display');
const txList = $('tx-list');
const screenUnlock = $('screen-unlock');
const unlockPassword = $('unlock-password');
const btnUnlock = $('btn-unlock');
const unlockError = $('unlock-error');
const modalPassword = $('modal-password');
const setPassword = $('set-password');
const setPasswordConfirm = $('set-password-confirm');
const setPasswordError = $('set-password-error');
const btnSetPassword = $('btn-set-password');

// ---------- CHAIN CONFIG ----------
const CHAIN = {
  btc: { name: 'Bitcoin', symbol: 'BTC', decimals: 8, explorer: 'https://blockchain.info/address/' },
  eth: { name: 'Ethereum', symbol: 'ETH', decimals: 18, explorer: 'https://etherscan.io/address/' },
  sol: { name: 'Solana', symbol: 'SOL', decimals: 9, explorer: 'https://solscan.io/address/' },
};

// ---------- CRYPTO (PBKDF2 -> AES-GCM vault) ----------
// The seed is encrypted with a key derived from the user's password.
// Nothing secret is stored unencrypted; without the password the vault
// (salt + ciphertext in chrome.storage.local) is useless.
const PBKDF2_ITERATIONS = 600000;

async function deriveKeyFromPassword(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptVault(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKeyFromPassword(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
  );
  const out = new Uint8Array(salt.length + iv.length + ct.length);
  out.set(salt, 0);
  out.set(iv, salt.length);
  out.set(ct, salt.length + iv.length);
  return btoa(String.fromCharCode(...out));
}

async function decryptVault(payload, password) {
  const buf = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const salt = buf.slice(0, 16);
  const iv = buf.slice(16, 28);
  const ct = buf.slice(28);
  const key = await deriveKeyFromPassword(password, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ---------- STORAGE HELPERS ----------
function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

async function storageSetVault(mnemonic, password) {
  const vault = await encryptVault(mnemonic, password);
  return new Promise((resolve) => chrome.storage.local.set({ vault }, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

// ---------- ADDRESS VALIDATION ----------
function validateAddress(chain, addr) {
  if (!addr || typeof addr !== 'string') return false;
  try {
    if (chain === 'btc') {
      bitcoin.address.toOutputScript(addr, bitcoin.networks.bitcoin);
      return true;
    }
    if (chain === 'eth') {
      return ethers.utils.isAddress(addr);
    }
    if (chain === 'sol') {
      new solWeb3.PublicKey(addr);
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

// ---------- BTC FEE ESTIMATION ----------
async function getBTCFeeRate() {
  try {
    const resp = await fetch('https://api.blockcypher.com/v1/btc/main');
    const data = await resp.json();
    const perKb = data.medium_fee_per_kb || data.high_fee_per_kb || 10000;
    return perKb / 1000;
  } catch (_) {
    return 20;
  }
}

function estimateBTCFeeSats(inputCount, hasChange, feeRate) {
  const outputs = hasChange ? 2 : 1;
  const vsize = inputCount * 148 + outputs * 34 + 10;
  return Math.max(546, Math.ceil(vsize * feeRate));
}

// ---------- SOLANA SLIP-0010 ED25519 DERIVATION ----------
// @noble/curves/ed25519 does not export HDKey, so derive the seed manually
// using Web Crypto HMAC-SHA512 (SLIP-0010, hardened path only).
async function deriveSolanaSeed(mnemonic) {
  const seed = new Uint8Array(await bip39.mnemonicToSeed(mnemonic));
  const enc = new TextEncoder();
  const masterKey = await crypto.subtle.importKey(
    'raw', enc.encode('ed25519 seed'), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  let I = new Uint8Array(await crypto.subtle.sign('HMAC', masterKey, seed));
  let key = I.slice(0, 32);
  let chain = I.slice(32);

  const path = [44, 501, 0, 0]; // m/44'/501'/0'/0'
  for (const i of path) {
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, 0x80000000 | i, false);
    const ck = await crypto.subtle.importKey(
      'raw', chain, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
    );
    I = new Uint8Array(await crypto.subtle.sign('HMAC', ck, data));
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  return key;
}

// ---------- WALLET GENERATION ----------
async function generateWallets(mnemonic) {
  const seed = await bip39.mnemonicToSeed(mnemonic);

  // --- BTC ---
  try {
    const btcRoot = bip32.fromMasterSeed(Buffer.from(seed));
    const btcChild = btcRoot.derive("m/44'/0'/0'/0/0");
    const { address } = bitcoin.payments.p2pkh({ pubkey: Buffer.from(btcChild.publicKey) });
    state.wallets.btc = {
      address,
      privateKey: wif.encode({ version: 0x80, privateKey: Buffer.from(btcChild.privateKey), compressed: true }),
      balance: 0,
      child: btcChild,
    };
  } catch (e) {
    console.error('BTC derivation error:', e, e?.stack || 'no stack');
  }

  // --- ETH ---
  try {
    const ethHD = ethers.utils.HDNode.fromMnemonic(mnemonic);
    const ethWallet = ethHD.derivePath("m/44'/60'/0'/0/0");
    state.wallets.eth = {
      address: ethWallet.address,
      privateKey: ethWallet.privateKey,
      balance: 0,
      wallet: new ethers.Wallet(ethWallet.privateKey),
    };
  } catch (e) {
    console.error('ETH derivation error:', e);
  }

  // --- SOL ---
  try {
    const solSeed = await deriveSolanaSeed(mnemonic);
    const keypair = solWeb3.Keypair.fromSeed(solSeed);
    state.wallets.sol = {
      address: keypair.publicKey.toBase58(),
      privateKey: Buffer.from(keypair.secretKey).toString('hex'),
      balance: 0,
      keypair,
    };
  } catch (e) {
    console.error('SOL derivation error:', e);
  }
}

// ---------- BALANCE FETCH ----------
async function fetchBalances() {
  const { btc, eth, sol } = state.wallets;

  // BTC
  try {
    const resp = await fetch(`https://blockchain.info/balance?active=${btc.address}`);
    const data = await resp.json();
    btc.balance = (data[btc.address]?.final_balance || 0) / 1e8;
  } catch (e) {
    console.warn('BTC balance fetch failed:', e);
  }

  // ETH
  try {
    const provider = new ethers.providers.JsonRpcProvider('https://ethereum-rpc.publicnode.com');
    const wei = await provider.getBalance(eth.address);
    eth.balance = parseFloat(ethers.utils.formatEther(wei));
  } catch (e) {
    console.warn('ETH balance fetch failed:', e);
  }

  // SOL
  try {
    const conn = new solWeb3.Connection('https://solana-rpc.publicnode.com');
    const pubkey = new solWeb3.PublicKey(sol.address);
    const lamports = await conn.getBalance(pubkey);
    sol.balance = lamports / 1e9;
  } catch (e) {
    console.warn('SOL balance fetch failed:', e);
  }
}

// ---------- COINGECKO PRICES ----------
let prices = { btc: 0, eth: 0, sol: 0 };

async function fetchPrices() {
  try {
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd'
    );
    const data = await resp.json();
    prices.btc = data.bitcoin?.usd || 0;
    prices.eth = data.ethereum?.usd || 0;
    prices.sol = data.solana?.usd || 0;
  } catch (e) {
    console.warn('Price fetch failed:', e);
  }
}

// ---------- UI UPDATE ----------
function updateUI() {
  const chain = state.activeChain;
  const w = state.wallets[chain];
  const info = CHAIN[chain];
  const bal = w.balance;
  const price = prices[chain];

  balanceDisplay.textContent = bal.toFixed(chain === 'btc' ? 8 : chain === 'sol' ? 4 : 6);
  currencyDisplay.textContent = info.symbol;
  usdDisplay.textContent = `$${(bal * price).toFixed(2)} USD`;
  addressDisplay.textContent = w.address;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTxs() {
  const chain = state.activeChain;
  const key = `txs_${chain}`;
  storageGet([key]).then((result) => {
    const txs = result[key] || [];
    if (txs.length === 0) {
      txList.textContent = 'No transactions yet';
    } else {
      txList.innerHTML = txs
        .map(
          (tx) => {
            const hash = (tx.hash || '').toString();
            const display = hash ? `${escapeHtml(hash.slice(0, 12))}...` : 'pending';
            const amt = escapeHtml(tx.amount);
            return `<div class="tx-item">
              <span class="tx-hash">${display}</span>
              <span class="tx-amt ${tx.type}">${tx.type === 'send' ? '-' : '+'}${amt} ${CHAIN[chain].symbol}</span>
            </div>`;
          }
        )
        .join('');
    }
  });
}

// ---------- SEND ----------
async function sendBTC(to, amountSat) {
  const { child, address } = state.wallets.btc;
  try {
    const feeRate = await getBTCFeeRate();
    const resp = await fetch(`https://api.blockcypher.com/v1/btc/main/addrs/${address}?unspentOnly=true`);
    const addrData = await resp.json();
    const utxos = [...(addrData.txrefs || []), ...(addrData.unconfirmed_txrefs || [])];
    if (utxos.length === 0) throw new Error('No UTXOs');

    const psbt = new bitcoin.Psbt();
    let totalInput = 0;
    let selected = 0;
    for (const utxo of utxos) {
      if (totalInput >= amountSat + estimateBTCFeeSats(selected, true, feeRate)) break;
      const rawTxResp = await fetch(`https://api.blockcypher.com/v1/btc/main/txs/${utxo.tx_hash}?includeHex=true`);
      const rawTxData = await rawTxResp.json();
      psbt.addInput({
        hash: utxo.tx_hash,
        index: utxo.tx_output_n,
        nonWitnessUtxo: Buffer.from(rawTxData.hex, 'hex'),
      });
      totalInput += utxo.value;
      selected++;
    }
    const fee = estimateBTCFeeSats(selected, true, feeRate);
    if (totalInput < amountSat + fee) throw new Error('Insufficient balance');

    psbt.addOutput({ address: to, value: amountSat });
    const change = totalInput - amountSat - fee;
    if (change >= 546) psbt.addOutput({ address, value: change });

    for (let i = 0; i < psbt.data.inputs.length; i++) {
      psbt.signInput(i, child);
    }
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction().toHex();

    const pushResp = await fetch('https://api.blockcypher.com/v1/btc/main/txs/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx }),
    });
    const pushData = await pushResp.json();
    return pushData.tx?.hash || pushData.hash;
  } catch (e) {
    throw new Error(`BTC send failed: ${e.message}`);
  }
}

async function sendETH(to, amountEth) {
  try {
    const provider = new ethers.providers.JsonRpcProvider('https://ethereum-rpc.publicnode.com');
    const wallet = state.wallets.eth.wallet.connect(provider);
    const tx = await wallet.sendTransaction({
      to,
      value: ethers.utils.parseEther(amountEth.toString()),
    });
    await tx.wait();
    return tx.hash;
  } catch (e) {
    throw new Error(`ETH send failed: ${e.message}`);
  }
}

async function sendSOL(to, amountSol) {
  try {
    const conn = new solWeb3.Connection('https://solana-rpc.publicnode.com');
    const from = state.wallets.sol.keypair;
    const toPubkey = new solWeb3.PublicKey(to);
    const ix = solWeb3.SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey,
      lamports: Math.round(amountSol * 1e9),
    });
    const tx = new solWeb3.Transaction().add(ix);
    const sig = await solWeb3.sendAndConfirmTransaction(conn, tx, [from]);
    return sig;
  } catch (e) {
    throw new Error(`SOL send failed: ${e.message}`);
  }
}

async function handleSend() {
  const chain = state.activeChain;
  const to = sendTo.value.trim();
  const amount = parseFloat(sendAmount.value);
  sendError.textContent = '';
  sendSuccess.textContent = '';

  if (!to || isNaN(amount) || amount <= 0) {
    sendError.textContent = 'Invalid address or amount';
    return;
  }

  const w = state.wallets[chain];
  if (amount > w.balance) {
    sendError.textContent = 'Insufficient balance';
    return;
  }

  if (!validateAddress(chain, to)) {
    sendError.textContent = 'Invalid recipient address for ' + chain.toUpperCase();
    return;
  }

  $('btn-execute-send').disabled = true;
  $('btn-execute-send').textContent = 'Sending...';

  try {
    let txHash;
    if (chain === 'btc') {
      const satoshis = Math.floor(amount * 1e8);
      txHash = await sendBTC(to, satoshis);
    } else if (chain === 'eth') {
      txHash = await sendETH(to, amount);
    } else {
      txHash = await sendSOL(to, amount);
    }
    if (!txHash) throw new Error('Transaction submitted but no hash was returned');
    sendSuccess.textContent = `Sent! TX: ${txHash.slice(0, 16)}...`;
    saveTx(chain, txHash, amount, 'send');
    await fetchBalances();
    updateUI();
    renderTxs();
  } catch (e) {
    sendError.textContent = e.message;
  } finally {
    $('btn-execute-send').disabled = false;
    $('btn-execute-send').textContent = 'Send';
  }
}

function saveTx(chain, hash, amount, type) {
  const key = `txs_${chain}`;
  storageGet([key]).then((result) => {
    const txs = result[key] || [];
    txs.unshift({ hash, amount, type, time: Date.now() });
    if (txs.length > 50) txs.length = 50;
    storageSet({ [key]: txs });
  });
}

// ---------- EVENT BINDING ----------
function bindEvents() {
  $('btn-create').addEventListener('click', async () => {
    const wordlist = bip39.wordlists?.english || bip39.wordlists?.EN;
    const mnemonic = bip39.generateMnemonic(128, undefined, wordlist);
    await createWalletFromMnemonic(mnemonic);
  });

  $('btn-show-import').addEventListener('click', () => {
    importArea.classList.remove('hidden');
  });

  $('btn-import').addEventListener('click', async () => {
    const phrase = importMnemonic.value.trim().toLowerCase();
    importError.textContent = '';
    const wordlist = bip39.wordlists?.english || bip39.wordlists?.EN;
    if (!bip39.validateMnemonic(phrase, wordlist)) {
      importError.textContent = 'Invalid seed phrase. Enter 12 or 24 words.';
      return;
    }
    await createWalletFromMnemonic(phrase);
  });

  $('btn-lock').addEventListener('click', async () => {
    if (!confirm('Exit and forget this wallet? Your funds are lost unless you saved the seed phrase.')) return;
    state.mnemonic = '';
    state.wallets = {
      btc: { address: '', privateKey: '', balance: 0, child: null },
      eth: { address: '', privateKey: '', balance: 0, wallet: null },
      sol: { address: '', privateKey: '', balance: 0, keypair: null },
    };
    await storageRemove(['vault', 'mnemonic']);
    showOnboard();
  });

  $('btn-unlock').addEventListener('click', async () => {
    if (unlockMode === 'none') {
      const result = await storageGet(['mnemonic']);
      if (!result.mnemonic) {
        showOnboard();
        return;
      }
      state.mnemonic = result.mnemonic;
      await generateWallets(result.mnemonic);
      await fetchPrices();
      await fetchBalances();
      showWallet();
      updateUI();
      renderTxs();
      return;
    }
    const pwd = unlockPassword.value;
    if (!pwd) return;
    const result = await storageGet(['vault']);
    try {
      const phrase = await decryptVault(result.vault, pwd);
      state.mnemonic = phrase;
      await generateWallets(phrase);
      await fetchPrices();
      await fetchBalances();
      showWallet();
      updateUI();
      renderTxs();
    } catch (_) {
      unlockError.textContent = 'Wrong password';
    }
  });

  unlockPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-unlock').click();
  });

  btnSetPassword.addEventListener('click', submitSetPassword);
  setPasswordConfirm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitSetPassword();
  });
  $('btn-set-password-skip').addEventListener('click', skipSetPassword);

  $('btn-send').addEventListener('click', () => {
    const isHidden = sendForm.classList.contains('hidden');
    const isClosing = sendForm.classList.contains('send-close');
    if (isHidden || isClosing) {
      sendForm.classList.remove('hidden', 'send-close');
      void sendForm.offsetHeight;
      sendForm.classList.add('send-open');
    } else {
      sendForm.classList.remove('send-open');
      sendForm.classList.add('send-close');
      setTimeout(() => { sendForm.classList.add('hidden'); }, 250);
    }
  });

  $('btn-execute-send').addEventListener('click', handleSend);

  $('btn-copy-address').addEventListener('click', () => {
    const chain = state.activeChain;
    const w = state.wallets[chain];
    if (w.address) {
      navigator.clipboard.writeText(w.address).then(() => {
        $('btn-copy-address').textContent = '✓ Copied';
        setTimeout(() => { $('btn-copy-address').textContent = 'Copy Receive Address'; }, 1500);
      });
    }
  });

  $('btn-show-mnemonic').addEventListener('click', () => {
    if (state.mnemonic) {
      mnemonicDisplay.textContent = state.mnemonic;
      modalMnemonic.classList.remove('hidden');
    }
  });

  $('btn-hide-mnemonic').addEventListener('click', () => {
    modalMnemonic.classList.add('hidden');
  });

  // Chain tab switching
  document.querySelectorAll('.chain-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.chain-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeChain = tab.dataset.chain;
      sendForm.classList.remove('send-open');
      sendForm.classList.add('send-close');
      setTimeout(() => { sendForm.classList.add('hidden'); }, 250);
      sendError.textContent = '';
      sendSuccess.textContent = '';
      sendTo.value = '';
      sendAmount.value = '';
      updateUI();
      renderTxs();
    });
  });

  // Close modal on overlay click
  modalMnemonic.addEventListener('click', (e) => {
    if (e.target === modalMnemonic) modalMnemonic.classList.add('hidden');
  });

  // Send/Receive keyboard shortcut
  sendTo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend();
  });
  sendAmount.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSend();
  });
}

// ---------- SCREEN MANAGEMENT ----------
function hideLoading() {
  screenLoading.classList.add('hidden');
}

function showOnboard() {
  hideLoading();
  screenOnboard.classList.remove('hidden');
  screenWallet.classList.add('hidden');
  modalMnemonic.classList.add('hidden');
  importMnemonic.value = '';
  importError.textContent = '';
  importArea.classList.add('hidden');
}

function showWallet() {
  hideLoading();
  screenOnboard.classList.add('hidden');
  screenWallet.classList.remove('hidden');
  modalMnemonic.classList.add('hidden');
}

function showUnlock(mode) {
  unlockMode = mode;
  hideLoading();
  screenOnboard.classList.add('hidden');
  screenWallet.classList.add('hidden');
  modalMnemonic.classList.add('hidden');
  unlockError.textContent = '';
  if (mode === 'password') {
    unlockPassword.style.display = '';
    unlockPassword.value = '';
    btnUnlock.textContent = 'Unlock';
  } else {
    unlockPassword.style.display = 'none';
    btnUnlock.textContent = 'Open Wallet';
  }
  screenUnlock.classList.remove('hidden');
}

let resolveSetPassword = null;
let unlockMode = 'password';

function promptSetPassword() {
  setPassword.value = '';
  setPasswordConfirm.value = '';
  setPasswordError.textContent = '';
  modalPassword.classList.remove('hidden');
  setPassword.focus();
  return new Promise((resolve) => {
    resolveSetPassword = resolve;
  });
}

function submitSetPassword() {
  const p = setPassword.value;
  if (p.length > 0 && p.length < 8) {
    setPasswordError.textContent = 'Password too short (min 8 characters)';
    return;
  }
  if (p.length > 0 && p !== setPasswordConfirm.value) {
    setPasswordError.textContent = 'Passwords do not match';
    return;
  }
  modalPassword.classList.add('hidden');
  const resolve = resolveSetPassword;
  resolveSetPassword = null;
  resolve(p.length > 0 ? p : null);
}

function skipSetPassword() {
  if (!confirm('Continue without a password? Your seed phrase will be stored UNENCRYPTED on this device. Anyone with access to this browser profile can read it.')) {
    return;
  }
  modalPassword.classList.add('hidden');
  const resolve = resolveSetPassword;
  resolveSetPassword = null;
  resolve(null);
}

async function createWalletFromMnemonic(mnemonic) {
  screenOnboard.classList.add('hidden');
  screenLoading.classList.remove('hidden');
  state.mnemonic = mnemonic;
  await generateWallets(mnemonic);
  const password = await promptSetPassword();
  if (password) {
    await storageSetVault(mnemonic, password);
  } else {
    await storageSet({ mnemonic });
  }
  await fetchPrices();
  await fetchBalances();
  showWallet();
  updateUI();
  renderTxs();
}

// ---------- INIT ----------
async function init() {
  const wordlist = bip39.wordlists?.english || bip39.wordlists?.EN;
  if (wordlist && bip39.setDefaultWordlist) {
    bip39.setDefaultWordlist('english');
  }

  bindEvents();

  const result = await storageGet(['vault', 'mnemonic']);
  if (result.vault) {
    showUnlock('password');
  } else if (result.mnemonic) {
    state.mnemonic = result.mnemonic;
    await generateWallets(result.mnemonic);
    await fetchPrices();
    await fetchBalances();
    showWallet();
    updateUI();
    renderTxs();
  } else {
    showOnboard();
  }

  // Periodic refresh
  setInterval(async () => {
    if (state.mnemonic) {
      await fetchPrices();
      await fetchBalances();
      updateUI();
    }
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
