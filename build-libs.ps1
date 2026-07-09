param(
    [switch]$Clean
)

$libsDir = Join-Path $PSScriptRoot "libs"
$entryJs = Join-Path $libsDir "entry.js"
$injectJs = Join-Path $libsDir "inject.js"
$bundleJs = Join-Path $libsDir "bundle.js"

if ($Clean -and (Test-Path $libsDir)) {
    Remove-Item -Path "$libsDir\*" -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $libsDir)) {
    New-Item -ItemType Directory -Path $libsDir -Force | Out-Null
}

Set-Location -LiteralPath $libsDir

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..."
    npm init -y 2>$null
    npm install bip39@3.1.0 bitcoinjs-lib@6.1.6 ethers@5.7.2 @solana/web3.js@1.95.3 @scure/bip32@2.2.0 wif@5.0.0 buffer@6.0.3 --save 2>$null
}

# Write entry point
@"
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
"@ | Out-File -FilePath $entryJs -Encoding utf8

# Write inject helper (resolves the global `Buffer` reference for bundled libs).
# NOTE: This is an esbuild --inject build input, NOT a runtime script. Do not
# load it via <script> or manifest; esbuild inlines it into bundle.js.
@"
import { Buffer as B } from 'buffer';
export { B as Buffer };
"@ | Out-File -FilePath $injectJs -Encoding utf8

Write-Host "Building bundle.js with esbuild..."
npx --yes esbuild@0.25.2 $entryJs --bundle --minify --outfile=$bundleJs --format=iife --platform=browser --inject:$injectJs 2>&1 | Out-Null

Remove-Item -Path $entryJs -Force -ErrorAction SilentlyContinue
Write-Host "Done! bundle.js created ($((Get-Item $bundleJs).Length / 1KB) KB)"
