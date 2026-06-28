/**
 * deploy.js
 *
 * JS wrapper around the Foundry deploy script.
 * Reads DEPLOYER_PRIVATE_KEY from .env and runs forge script.
 *
 * Prerequisites: forge installed (foundryup)
 *
 * Run: npm run deploy
 */

import { execSync }  from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import dotenv from 'dotenv'
dotenv.config()
const ARC_RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'

function log(msg) { console.log(`[deploy] ${msg}`) }

function checkFoundry() {
  try {
    execSync('forge --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

async function main() {
  // ── Check Foundry installed ───────────────────────
  if (!checkFoundry()) {
    console.error(`
Foundry not found. Install it:

  curl -L https://foundry.paradigm.xyz | bash
  source ~/.bashrc
  foundryup

Then re-run: npm run deploy
`)
    process.exit(1)
  }

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!deployerKey || deployerKey.startsWith('0xac0974')) {
    console.error(`
DEPLOYER_PRIVATE_KEY not set or is still the test key.

You need your actual Arc testnet wallet private key.
Options:

  Option A — Use the test key for Arc testnet (safe — testnet only):
    Keep DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
    Fund this address on Arc faucet: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

  Option B — Export your Circle wallet key:
    Go to Circle Console → Wallets → Export private key
    Set DEPLOYER_PRIVATE_KEY=<exported key>

Using test key for now...
`)
  }

  const key = deployerKey || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  const agentWallet = process.env.AGENT_ADDRESS || process.env.DEPLOYER_ADDRESS || ''

  log('Running Foundry deploy script...')
  log(`RPC: ${ARC_RPC}`)
  log(`Agent wallet: ${agentWallet}`)

  const cmd = [
    'forge script script/Deploy.s.sol',
    `--rpc-url ${ARC_RPC}`,
    `--private-key ${key}`,
    '--broadcast',
    '--legacy',   // Arc testnet uses legacy tx format
    '-vvvv',
  ].filter(Boolean).join(' \\\n  ')

  log('Running:\n  ' + cmd.replace(/--private-key 0x\S+/, '--private-key ***') + '\n')

  try {
    const output = execSync(cmd, {
      env: { ...process.env, AGENT_WALLET: agentWallet },
      stdio: 'inherit',
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (err) {
    if (err.status !== 0) {
      console.error('\nDeploy failed. Common fixes:')
      console.error('  1. Fund your deployer wallet at https://faucet.arc.testnet.circle.com')
      console.error('  2. Check Arc RPC is accessible: curl ' + ARC_RPC)
      console.error('  3. Run with --legacy flag if nonce error')
      process.exit(1)
    }
  }

  log('\nDeployment complete.')
  log('Copy the printed addresses into your .env file.')
  log('Then run: npm run agent:mev')
}

main().catch(err => {
  console.error('Deploy error:', err.message)
  process.exit(1)
})
