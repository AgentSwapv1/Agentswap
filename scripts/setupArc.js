/**
 * setupArc.js
 * Creates two Circle developer-controlled wallets on Arc testnet,
 * derives ERC-8004 agent ID, and writes everything to .env
 *
 * Run: node scripts/setupArc.js
 */

import { CircleDeveloperControlledWalletsClient, Blockchain } from '@circle-fin/developer-controlled-wallets'
import { keccak256, toBytes } from 'viem'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import dotenv from 'dotenv'
dotenv.config()

const ERC8004 = {
  identityRegistry:   '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
  agenticCommerce:    '0x0747EEf0706327138c69792bF28Cd525089e4583',
}

function log(msg) { console.log(`[setup-arc] ${msg}`) }

async function main() {
  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
    console.error(`
ERROR: Missing Circle credentials.

Steps:
  1. Create account at https://console.circle.com
  2. Keys → Create Key → Standard Key  → copy it
  3. Run: node -e "import('@circle-fin/developer-controlled-wallets').then(m => console.log(m.generateEntitySecret()))"
  4. Paste both into your .env file:
       CIRCLE_API_KEY=your_api_key
       CIRCLE_ENTITY_SECRET=your_64char_hex_secret
  5. Re-run: npm run setup:arc
`)
    process.exit(1)
  }

  log('Connecting to Circle API...')
  const client = new CircleDeveloperControlledWalletsClient({
    apiKey:       process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  })

  // ── Create wallet set ─────────────────────────
  log('Creating AgentSwap wallet set...')
  const wsRes = await client.createWalletSet({ name: 'AgentSwap-Wallets' })
  const walletSetId = wsRes.data?.walletSet?.id
  if (!walletSetId) throw new Error('Wallet set creation failed: ' + JSON.stringify(wsRes))
  log(`Wallet set: ${walletSetId}`)

  // ── Create 2 wallets ──────────────────────────
  log('Creating deployer + agent wallets on Arc testnet...')
  const walletsRes = await client.createWallets({
    blockchains:  [Blockchain.ArcTestnet],
    count:        2,
    walletSetId,
    accountType:  'SCA',
  })

  const wallets        = walletsRes.data?.wallets || []
  const deployerWallet = wallets[0]
  const agentWallet    = wallets[1]

  if (!deployerWallet || !agentWallet) {
    throw new Error('Wallet creation failed: ' + JSON.stringify(walletsRes))
  }

  log(`Deployer: ${deployerWallet.address}`)
  log(`Agent:    ${agentWallet.address}`)

  // ── Derive agent ERC-8004 ID ──────────────────
  const agentId = keccak256(toBytes(`agentswap-mev-${agentWallet.address}`))
  log(`Agent ERC-8004 ID: ${agentId}`)

  // ── Merge into .env ───────────────────────────
  const envPath   = '.env'
  const existing  = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : ''
  const newVars   = {
    ARC_RPC_URL:          'https://rpc.testnet.arc.network',
    CHAIN_ID:             '1516',
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

  let content = existing
  for (const [k, v] of Object.entries(newVars)) {
    const rx = new RegExp(`^${k}=.*$`, 'm')
    content = rx.test(content) ? content.replace(rx, `${k}=${v}`) : content + `\n${k}=${v}`
  }
  writeFileSync(envPath, content.trim() + '\n')
  log('.env updated ✓')

  console.log(`
─── Arc Setup Complete ───────────────────────────

  Wallet set:  ${walletSetId}
  Deployer:    ${deployerWallet.address}
  Agent:       ${agentWallet.address}
  Agent ID:    ${agentId}

  ERC-8004 contracts (Arc testnet):
    IdentityRegistry:   ${ERC8004.identityRegistry}
    ReputationRegistry: ${ERC8004.reputationRegistry}
    AgenticCommerce:    ${ERC8004.agenticCommerce}

  Next steps:
  1. Fund both wallets at https://faucet.arc.testnet.circle.com
  2. Run: npm run setup:circle   (verify balances)
  3. Run: npm run deploy         (deploy hook)
  4. Run: npm run agent:mev      (start agent)
  5. Run: npm run dashboard      (open localhost:3000)


─────────────────────────────────────────────────
`)
}

main().catch(err => {
  console.error('\nSetup error:', err.message || err)
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2))
  process.exit(1)
})
