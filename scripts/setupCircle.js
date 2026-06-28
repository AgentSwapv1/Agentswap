/**
 * setupCircle.js
 * Verifies wallet balances and prints hook funding instructions.
 * Run after: npm run setup:arc + funding wallets at faucet
 *
 * Run: node scripts/setupCircle.js
 */

import { CircleDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'
import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import dotenv from 'dotenv'
dotenv.config()

const arcTestnet = {
  id: 1516,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'] } },
}

const USDC_ABI = parseAbi(['function balanceOf(address) external view returns (uint256)'])
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0xFbDa5F676cB37624f28265A144A48B0d6e87d3b6'

function log(msg) { console.log(`[setup-circle] ${msg}`) }

async function main() {
  const missing = ['CIRCLE_API_KEY','CIRCLE_ENTITY_SECRET'].filter(k => !process.env[k])
  if (missing.length) {
    console.error(`Missing: ${missing.join(', ')} — run npm run setup:arc first`)
    process.exit(1)
  }

  const client = new CircleDeveloperControlledWalletsClient({
    apiKey:       process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  })

  const pub = createPublicClient({ chain: arcTestnet, transport: http() })

  log('Fetching wallet details...')

  const results = []
  for (const [label, id] of [['Deployer', process.env.DEPLOYER_WALLET_ID], ['Agent', process.env.AGENT_WALLET_ID]]) {
    if (!id) { results.push({ label, state: 'NOT SET — run setup:arc first', balance: '?' }); continue }
    try {
      const w = await client.getWallet({ id })
      const addr = w.data?.wallet?.address || process.env[label.toUpperCase() + '_ADDRESS']
      let balance = '?'
      try {
        const raw = await pub.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: 'balanceOf', args: [addr] })
        balance = Number(formatUnits(raw, 6)).toFixed(2) + ' USDC'
      } catch { balance = 'RPC unreachable (normal in some environments)' }
      results.push({ label, id, address: addr, state: w.data?.wallet?.state, balance })
    } catch (err) {
      results.push({ label, id, state: 'Error: ' + err.message, balance: '?' })
    }
  }

  console.log('\n─── Wallet Status ──────────────────────────')
  for (const r of results) {
    console.log(`\n  ${r.label}`)
    if (r.address) console.log(`    Address: ${r.address}`)
    if (r.state)   console.log(`    State:   ${r.state}`)
    console.log(`    Balance: ${r.balance}`)
  }

  console.log(`
─── Fund Wallets ────────────────────────────

  1. Go to: https://faucet.arc.testnet.circle.com
  2. Request USDC for each address above
  3. Wait ~30s then re-run: npm run setup:circle

─── Fund Hook Contract (after deploy) ───────

  circle wallets transfer \\
    --wallet-id ${process.env.DEPLOYER_WALLET_ID || '<DEPLOYER_WALLET_ID>'} \\
    --destination-address ${process.env.HOOK_ADDRESS || '<HOOK_ADDRESS after deploy>'} \\
    --amounts 10 \\
    --token-id USDC

─────────────────────────────────────────────
`)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
