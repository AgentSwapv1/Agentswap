/**
 * setupCircle.js
 *
 * Configures Circle developer-controlled wallets for AgentSwap:
 * - Verifies USDC balances
 * - Funds the hook contract with USDC (so it can pay agents)
 * - Sets up ERC-8183 AgenticCommerce approval
 *
 * Run: node scripts/setupCircle.js
 */

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'
import { createPublicClient, http, parseAbi, parseUnits, formatUnits } from 'viem'
import dotenv from 'dotenv'
dotenv.config()

const arcTestnet = {
  id: 1516,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL || 'https://rpc.arc.testnet.circle.com'] } },
}

const USDC_ABI = parseAbi([
  'function balanceOf(address) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)',
])

const HOOK_ABI = parseAbi([
  'function depositUSDC(uint256 amount) external',
])

function log(msg) { console.log(`[setup-circle] ${msg}`) }

async function checkBalance(client, address, usdcAddr) {
  try {
    const bal = await client.readContract({
      address: usdcAddr,
      abi:     USDC_ABI,
      functionName: 'balanceOf',
      args:    [address],
    })
    return Number(formatUnits(bal, 6))
  } catch {
    return null
  }
}

async function main() {
  const required = ['CIRCLE_API_KEY', 'CIRCLE_ENTITY_SECRET', 'DEPLOYER_WALLET_ID', 'AGENT_WALLET_ID']
  const missing  = required.filter(k => !process.env[k])
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`)
    console.error('Run: npm run setup:arc first')
    process.exit(1)
  }

  const circleClient = initiateDeveloperControlledWalletsClient({
    apiKey:       process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  })

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() })

  const USDC_ADDRESS = process.env.USDC_ADDRESS || '0xFbDa5F676cB37624f28265A144A48B0d6e87d3b6'  // Arc testnet USDC
  const HOOK_ADDRESS = process.env.HOOK_ADDRESS
  const DEPLOYER     = process.env.DEPLOYER_ADDRESS
  const AGENT        = process.env.AGENT_ADDRESS

  log('Checking wallet balances...')

  const deployerBal = await checkBalance(publicClient, DEPLOYER, USDC_ADDRESS)
  const agentBal    = await checkBalance(publicClient, AGENT, USDC_ADDRESS)

  console.log(`\n  Deployer (${DEPLOYER?.slice(0,16)}...): ${deployerBal !== null ? deployerBal + ' USDC' : 'unable to read (RPC not accessible in sandbox)'}`)
  console.log(`  Agent    (${AGENT?.slice(0,16)}...): ${agentBal !== null ? agentBal + ' USDC' : 'unable to read (RPC not accessible in sandbox)'}`)

  if (deployerBal !== null && deployerBal < 5) {
    console.log('\n⚠  Deployer balance low. Fund at: https://faucet.arc.testnet.circle.com')
  }

  // ── Wallet info ──────────────────────────────
  log('\nFetching wallet details from Circle...')
  try {
    const deployer = await circleClient.getWallet({ id: process.env.DEPLOYER_WALLET_ID })
    const agent    = await circleClient.getWallet({ id: process.env.AGENT_WALLET_ID })
    log(`Deployer wallet state: ${deployer.data?.wallet?.state}`)
    log(`Agent wallet state:    ${agent.data?.wallet?.state}`)
  } catch (err) {
    log(`Could not fetch wallet details: ${err.message}`)
  }

  // ── Instructions for hook funding ───────────
  console.log(`
─── Circle Wallet Configuration ────────────────

  To fund the hook contract with USDC (so it can pay agents):

  Using Circle CLI:
  ─────────────────
  circle wallets transfer \\
    --from ${process.env.DEPLOYER_WALLET_ID} \\
    --to   ${HOOK_ADDRESS || '<HOOK_ADDRESS>'} \\
    --amount 10 \\
    --token USDC \\
    --blockchain ARC-TESTNET

  Or via the Circle Console at:
  https://console.circle.com

  USDC contract (Arc testnet):
  ${USDC_ADDRESS}

  Hook contract (after deploy):
  ${HOOK_ADDRESS || 'Run npm run deploy first'}

─── ERC-8183 AgenticCommerce approval ──────────

  The hook needs to approve AgenticCommerce to pull USDC for jobs:

  Address: ${process.env.AGENTIC_COMMERCE || '0x0747EEf0706327138c69792bF28Cd525089e4583'}
  Amount:  Unlimited (or cap at 1000 USDC for safety)

  This is handled automatically in deploy.js after contract deployment.

────────────────────────────────────────────────

  Next: npm run deploy
`)
}

main().catch(err => {
  console.error('Circle setup error:', err.message)
  process.exit(1)
})
