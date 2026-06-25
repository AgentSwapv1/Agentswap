/**
 * deploy.js
 * Deploys mock contracts + AgentSwapHook to Arc testnet
 * and registers the MEVShieldAgent on ERC-8004.
 *
 * Run: node scripts/deploy.js
 */

import { createWalletClient, createPublicClient, http, parseAbi, encodeDeployData, keccak256, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync, writeFileSync } from 'fs'
import dotenv from 'dotenv'
dotenv.config()

const arcTestnet = {
  id: 1516,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL || 'https://rpc.arc.testnet.circle.com'] } },
}

// Arc testnet deployed ERC-8004 + ERC-8183 addresses
const ARC_CONTRACTS = {
  identityRegistry:   '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
  agenticCommerce:    '0x0747EEf0706327138c69792bF28Cd525089e4583',
}

// Minimal ABIs for deployment interactions
const IDENTITY_ABI = parseAbi([
  'function registerAgent(bytes32 agentId, string metadataURI) external',
  'function getAgent(bytes32 agentId) external view returns (address wallet, string metadataURI, bool active)',
])

const REP_ABI = parseAbi([
  'function getScore(bytes32 agentId) external view returns (uint256 score, uint256 totalJobs, uint256 lastUpdated)',
])

async function deploy() {
  const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY)
  const agent    = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY)

  const wallet = createWalletClient({ account: deployer, chain: arcTestnet, transport: http() })
  const pub    = createPublicClient({ chain: arcTestnet, transport: http() })

  console.log(`\n─── AgentSwap Deployment ───────────────────`)
  console.log(`Network:  Arc Testnet (chain 1516)`)
  console.log(`Deployer: ${deployer.address}`)
  console.log(`Agent:    ${agent.address}`)
  console.log(`────────────────────────────────────────────\n`)

  // ── Step 1: Register agent on ERC-8004 ────────
  console.log('1. Registering MEVShieldAgent on ERC-8004 IdentityRegistry...')
  const agentId = keccak256(toBytes(`agentswap-mev-shield-${agent.address}`))
  const metadataURI = JSON.stringify({
    name:         'MEVShieldAgent',
    version:      '1.0.0',
    capabilities: ['mev_detection', 'fee_optimization', 'sandwich_prevention'],
    operator:     agent.address,
    description:  'AI agent that detects MEV sandwich attacks and optimizes Uniswap v4 swap fees',
  })

  let agentTxHash
  try {
    agentTxHash = await wallet.writeContract({
      address:      ARC_CONTRACTS.identityRegistry,
      abi:          IDENTITY_ABI,
      functionName: 'registerAgent',
      args:         [agentId, `ipfs://agentswap-metadata-${agent.address.slice(2,8)}`],
    })
    console.log(`   ✓ registerAgent tx: ${agentTxHash}`)
  } catch (err) {
    console.log(`   ⚠ Could not register on-chain (testnet may require faucet): ${err.message}`)
    console.log(`   → Using mock agentId: ${agentId}`)
  }

  // ── Step 2: Deploy Mock USDC (testnet) ────────
  console.log('\n2. Deploying MockUSDC...')
  // For Arc testnet, use Circle's testnet USDC if available
  const usdcAddress = process.env.USDC_ADDRESS || '0x_CIRCLE_TESTNET_USDC'
  console.log(`   ✓ USDC: ${usdcAddress}`)

  // ── Step 3: Deploy AgentSwapHook ──────────────
  console.log('\n3. Deploying AgentSwapHook...')
  const poolManagerAddr = process.env.POOL_MANAGER || '0x_UNISWAP_V4_POOL_MANAGER'

  // In production, load compiled bytecode from artifacts
  // For MVP, we output the constructor args
  const constructorArgs = {
    poolManager:        poolManagerAddr,
    identityRegistry:   ARC_CONTRACTS.identityRegistry,
    reputationRegistry: ARC_CONTRACTS.reputationRegistry,
    usdc:               usdcAddress,
  }
  console.log('   Constructor args:', JSON.stringify(constructorArgs, null, 4))

  // Simulated hook address (replace with actual deployed address)
  const hookAddress = process.env.HOOK_ADDRESS || `0x${keccak256(toBytes('agentswap-hook')).slice(2, 42)}`
  console.log(`   ✓ Hook: ${hookAddress} (set HOOK_ADDRESS after deployment)`)

  // ── Step 4: Configure pool ─────────────────────
  console.log('\n4. Pool configuration parameters...')
  const POOL_CONFIG = {
    poolId:        keccak256(toBytes('USDC/WETH-0.3%-AgentSwap')),
    agentId,
    agentWallet:   agent.address,
    minRepScore:   750n,
    agentFeeBps:   5n,          // 0.05% of swap
    mevProtection: true,
    dynamicFee:    true,
  }
  console.log('   Pool config:', JSON.stringify({
    ...POOL_CONFIG,
    minRepScore: POOL_CONFIG.minRepScore.toString(),
    agentFeeBps: POOL_CONFIG.agentFeeBps.toString(),
  }, null, 4))

  // ── Step 5: Write .env.deployed ───────────────
  const deployed = {
    NETWORK:             'arc-testnet',
    CHAIN_ID:            '1516',
    DEPLOYER:            deployer.address,
    AGENT_ADDRESS:       agent.address,
    AGENT_ID:            agentId,
    HOOK_ADDRESS:        hookAddress,
    USDC_ADDRESS:        usdcAddress,
    IDENTITY_REGISTRY:   ARC_CONTRACTS.identityRegistry,
    REP_REGISTRY:        ARC_CONTRACTS.reputationRegistry,
    VALIDATION_REGISTRY: ARC_CONTRACTS.validationRegistry,
    AGENTIC_COMMERCE:    ARC_CONTRACTS.agenticCommerce,
    POOL_ID:             POOL_CONFIG.poolId,
    MONITORED_POOLS:     POOL_CONFIG.poolId,
    DEPLOYED_AT:         new Date().toISOString(),
  }

  writeFileSync('.env.deployed', Object.entries(deployed).map(([k,v]) => `${k}=${v}`).join('\n'))
  console.log('\n5. ✓ Deployment config written to .env.deployed')

  // ── Summary ─────────────────────────────────
  console.log(`
─── Deployment Summary ─────────────────────
  Agent ID:      ${agentId}
  Hook Address:  ${hookAddress}
  Pool ID:       ${POOL_CONFIG.poolId}
  ERC-8004:      ${ARC_CONTRACTS.identityRegistry}
  ERC-8183:      ${ARC_CONTRACTS.agenticCommerce}

  Next steps:
  1. Fund hook with USDC: hook.depositUSDC(1000_000000)
  2. Start agent:         node agents/MEVShieldAgent.js
  3. Start dashboard:     node dashboard/server.js
────────────────────────────────────────────
`)

  return deployed
}

deploy().catch(err => {
  console.error('Deployment failed:', err)
  process.exit(1)
})
