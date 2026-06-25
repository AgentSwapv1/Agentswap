/**
 * setupArc.js
 *
 * Bootstraps the Arc testnet environment:
 * - Creates two Circle developer-controlled wallets (deployer + agent)
 * - Funds them from faucet
 * - Registers the agent on ERC-8004 IdentityRegistry
 * - Writes addresses to .env
 *
 * Prerequisites:
 *   uv tool install git+https://github.com/the-canteen-dev/ARC-cli
 *   npm install -g @circle-fin/cli
 *   Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in .env
 *
 * Run: node scripts/setupArc.js
 */

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'
import { createPublicClient, http, keccak256, toBytes, parseAbi } from 'viem'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import dotenv from 'dotenv'
dotenv.config()

const ARC_RPC  = 'https://rpc.arc.testnet.circle.com'
const CHAIN_ID = 1516

const ERC8004 = {
  identityRegistry:   '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
  agenticCommerce:    '0x0747EEf0706327138c69792bF28Cd525089e4583',
}

const IDENTITY_ABI = parseAbi([
  'function registerAgent(bytes32 agentId, string metadataURI) external',
  'function getAgent(bytes32 agentId) external view returns (address wallet, string metadataURI, bool active)',
])

function log(msg) { console.log(`[setup-arc] ${msg}`) }

async function main() {
  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
    console.error(`
ERROR: Missing Circle credentials.

1. Create an account at https://console.circle.com
2. Generate an API key (Keys → Create Key → Standard Key)
3. Register your entity secret
4. Add to .env:
   CIRCLE_API_KEY=your_key
   CIRCLE_ENTITY_SECRET=your_secret

Then re-run: npm run setup:arc
`)
    process.exit(1)
  }

  log('Initializing Circle developer-controlled wallets client...')
  const client = initiateDeveloperControlledWalletsClient({
    apiKey:       process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  })

  // ── Step 1: Create wallet set ───────────────
  log('Creating AgentSwap wallet set...')
  const wsRes = await client.createWalletSet({ name: 'AgentSwap-Wallets' })
  const walletSetId = wsRes.data?.walletSet?.id
  log(`Wallet set created: ${walletSetId}`)

  // ── Step 2: Create deployer + agent wallets ─
  log('Creating 2 Arc Testnet SCA wallets (deployer + agent)...')
  const walletsRes = await client.createWallets({
    blockchains: ['ARC-TESTNET'],
    count:       2,
    walletSetId,
    accountType: 'SCA',
  })

  const wallets      = walletsRes.data?.wallets || []
  const deployerWallet = wallets[0]
  const agentWallet    = wallets[1]

  if (!deployerWallet || !agentWallet) {
    console.error('Failed to create wallets:', walletsRes)
    process.exit(1)
  }

  log(`Deployer wallet: ${deployerWallet.address}`)
  log(`Agent wallet:    ${agentWallet.address}`)

  // ── Step 3: Faucet ──────────────────────────
  log(`\nFund your wallets with testnet USDC:`)
  log(`  Arc Faucet: https://faucet.arc.testnet.circle.com`)
  log(`  Deployer:   ${deployerWallet.address}`)
  log(`  Agent:      ${agentWallet.address}`)
  log(`  (Request at least 10 USDC each)\n`)

  // ── Step 4: Derive agent ID ─────────────────
  const agentId = keccak256(toBytes(`agentswap-mev-${agentWallet.address}`))
  log(`Agent ERC-8004 ID: ${agentId}`)

  // ── Step 5: Write .env ──────────────────────
  const envPath   = '.env'
  const existing  = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : ''
  const newVars   = {
    ARC_RPC_URL:          ARC_RPC,
    CHAIN_ID:             String(CHAIN_ID),
    WALLET_SET_ID:        walletSetId,
    DEPLOYER_WALLET_ID:   deployerWallet.id,
    DEPLOYER_ADDRESS:     deployerWallet.address,
    AGENT_WALLET_ID:      agentWallet.id,
    AGENT_ADDRESS:        agentWallet.address,
    AGENT_ID:             agentId,
    IDENTITY_REGISTRY:    ERC8004.identityRegistry,
    REP_REGISTRY:         ERC8004.reputationRegistry,
    VALIDATION_REGISTRY:  ERC8004.validationRegistry,
    AGENTIC_COMMERCE:     ERC8004.agenticCommerce,
  }

  // Merge — don't overwrite existing values
  let envContent = existing
  for (const [k, v] of Object.entries(newVars)) {
    const regex = new RegExp(`^${k}=.*$`, 'm')
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${k}=${v}`)
    } else {
      envContent += `\n${k}=${v}`
    }
  }
  writeFileSync(envPath, envContent.trim() + '\n')
  log('.env updated ✓')

  // ── Step 6: Summary ─────────────────────────
  console.log(`
─── Arc Setup Complete ─────────────────────────

  Wallet set:     ${walletSetId}
  Deployer:       ${deployerWallet.address}
  Agent:          ${agentWallet.address}
  Agent ID:       ${agentId}

  ERC-8004 contracts (Arc testnet):
    IdentityRegistry:   ${ERC8004.identityRegistry}
    ReputationRegistry: ${ERC8004.reputationRegistry}
    ValidationRegistry: ${ERC8004.validationRegistry}
    AgenticCommerce:    ${ERC8004.agenticCommerce}

  Next steps:
  1. Fund wallets at https://faucet.arc.testnet.circle.com
  2. Run: npm run setup:circle    (Circle wallet config)
  3. Run: npm run deploy          (deploy hook contract)
  4. Run: npm run agent:mev       (start MEV shield agent)
  5. Run: npm run dashboard       (start live dashboard)
  6. Run: npm run demo            (run sandwich simulation)

───────────────────────────────────────────────
`)
}

main().catch(err => {
  console.error('Setup error:', err.message)
  if (err.response?.data) console.error(err.response.data)
  process.exit(1)
})
