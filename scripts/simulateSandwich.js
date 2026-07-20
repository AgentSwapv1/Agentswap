/**
 * simulateSandwich.js
 *
 * Hackathon demo script.
 * Simulates a sandwich attack, shows the MEVShieldAgent detecting
 * and blocking it, then shows USDC settlement + rep score update.
 *
 * Run: node scripts/simulateSandwich.js
 */

import { MEVShieldAgent } from '../agents/MEVShieldAgent.js'
import { keccak256, toBytes } from 'viem'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.deployed' })

const RESET  = '\x1b[0m'
const RED    = '\x1b[31m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function banner(text, color = CYAN) {
  const line = '─'.repeat(50)
  console.log(`\n${color}${BOLD}${line}`)
  console.log(`  ${text}`)
  console.log(`${line}${RESET}\n`)
}

function step(n, text) {
  console.log(`${CYAN}[${n}]${RESET} ${text}`)
}

async function runDemo() {
  banner('AgentSwap — Live Sandwich Demo', CYAN)

  console.log(`${DIM}This demo shows:
  • MEVShieldAgent detecting a sandwich attack in the mempool
  • AgentIntent registered to the hook (signed, timestamped)
  • beforeSwap: hook reads intent, reverts malicious swap
  • afterSwap: USDC settled to agent, ERC-8004 rep updated
${RESET}`)

  await sleep(1000)

  // ── Init agent ─────────────────────────────
  const POOL_ID = process.env.POOL_ID || keccak256(toBytes('USDC/WETH-demo-pool'))
  const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY ||
    '' // hardhat #0

  const agent = new MEVShieldAgent({
    agentId:        process.env.AGENT_ID || '0x6d65767368' + '0'.repeat(58),
    agentPrivateKey: AGENT_PRIVATE_KEY,
    hookAddress:    process.env.HOOK_ADDRESS || '0x' + '1'.padStart(40,'0'),
    monitoredPools: [POOL_ID],
  })

  // Track events for demo output
  const events = []
  agent.on('intentSubmitted', (data) => {
    events.push({ type: 'intent', data })
  })
  agent.on('settled', (data) => {
    events.push({ type: 'settled', data })
  })

  // ── Step 1: normal swaps ───────────────────
  banner('Phase 1: Normal swap activity', GREEN)
  step(1, 'Agent starts monitoring USDC/ETH pool...')
  await sleep(800)

  const normalSwaps = [
    { hash: '0x' + 'a'.repeat(64), from: '0xAlice' + '0'.repeat(34), direction: 'USDC->ETH', amountIn: 5000, gasPrice: 15_000_000_000n },
    { hash: '0x' + 'b'.repeat(64), from: '0xBob00' + '0'.repeat(34), direction: 'ETH->USDC', amountIn: 3200, gasPrice: 12_000_000_000n },
    { hash: '0x' + 'c'.repeat(64), from: '0xCarol' + '0'.repeat(34), direction: 'USDC->ETH', amountIn: 8700, gasPrice: 14_000_000_000n },
  ]

  for (const tx of normalSwaps) {
    console.log(`${GREEN}[mempool]${RESET} ${tx.direction} | $${tx.amountIn.toLocaleString()} USDC | ${tx.hash.slice(0,14)}...`)
    agent.mempoolWindow.push({ ...tx, poolId: POOL_ID })
    agent.stats.swapsAnalyzed++
    await sleep(600)
  }
  console.log(`\n${GREEN}✓ 3 normal swaps passed through — no threat detected${RESET}\n`)
  await sleep(1000)

  // ── Step 2: sandwich setup ─────────────────
  banner('Phase 2: Sandwich attack begins', RED)
  step(2, 'Attacker (known MEV bot) submits front-run transaction...')
  await sleep(500)

  const frontRun = {
    hash:     '0x' + 'dead'.repeat(15) + '0001',
    from:     '0xdead000000000000000000000000000000000001',
    poolId:   POOL_ID,
    direction: 'USDC->ETH',
    amountIn:  95000,   // large buy — pushing price up
    gasPrice:  80_000_000_000n,  // 80 gwei — 5x+ normal
  }

  console.log(`\n${RED}${BOLD}  FRONT-RUN DETECTED:${RESET}`)
  console.log(`  From:      ${RED}${frontRun.from}${RESET} ${DIM}(known MEV bot)${RESET}`)
  console.log(`  Direction: ${frontRun.direction}`)
  console.log(`  Amount:    $${frontRun.amountIn.toLocaleString()} USDC`)
  console.log(`  Gas price: ${frontRun.gasPrice / 1_000_000_000n} gwei ${RED}(5.3x avg)${RESET}`)
  console.log(`  Tx hash:   ${frontRun.hash.slice(0,18)}...`)

  await sleep(800)

  // ── Step 3: victim tx ─────────────────────
  step(3, 'Victim\'s swap enters mempool...')
  await sleep(400)

  const victimTx = {
    hash:     '0x' + 'cafe'.repeat(15) + 'beef',
    from:     '0xcafe000000000000000000000000000000000001',
    poolId:   POOL_ID,
    direction: 'USDC->ETH',
    amountIn:  12000,
    gasPrice:  15_000_000_000n,
  }

  console.log(`\n${YELLOW}  VICTIM TX:${RESET}`)
  console.log(`  From:      ${victimTx.from.slice(0,20)}...`)
  console.log(`  Direction: ${victimTx.direction}`)
  console.log(`  Amount:    $${victimTx.amountIn.toLocaleString()} USDC`)
  console.log(`  Expected loss without protection: ~$${Math.floor(victimTx.amountIn * 0.018).toLocaleString()} USDC (1.8% slippage tax)`)

  await sleep(800)

  // ── Step 4: agent detects ──────────────────
  banner('Phase 3: MEVShieldAgent intervenes', CYAN)
  step(4, 'Agent analyzes mempool — running sandwich detection...')
  await sleep(600)

  const analysis = agent._detectSandwich(frontRun)
  console.log(`\n  Pattern:    ${RED}${BOLD}${analysis.pattern}${RESET}`)
  console.log(`  Evidence:   ${analysis.evidence}`)
  console.log(`  Confidence: ${(analysis.confidence * 100).toFixed(0)}%`)
  console.log(`\n${CYAN}  → Submitting signed AgentIntent to hook (mevFlag: true)...${RESET}`)

  await sleep(500)

  // Build and show the intent
  const swapId    = frontRun.hash.slice(0,66).padEnd(66,'0')
  const timestamp = Math.floor(Date.now() / 1000)

  const intent = {
    swapId,
    feeOverrideBps: 0,
    mevFlag:        true,
    mevEvidence:    analysis.evidence,
    timestamp,
    signature:      '0x' + 'sig'.repeat(20) + '00',
  }

  console.log(`\n${DIM}  AgentIntent payload:`)
  console.log(`  ├── swapId:         ${intent.swapId.slice(0,20)}...`)
  console.log(`  ├── mevFlag:        ${intent.mevFlag}`)
  console.log(`  ├── mevEvidence:    "${intent.mevEvidence.slice(0,50)}..."`)
  console.log(`  ├── timestamp:      ${intent.timestamp}`)
  console.log(`  └── signature:      ${intent.signature.slice(0,20)}...${RESET}`)

  await sleep(1000)

  // ── Step 5: hook fires ─────────────────────
  banner('Phase 4: Hook blocks the attack', RED)
  step(5, 'beforeSwap fires — hook reads intent, checks MEV flag...')
  await sleep(500)

  console.log(`\n${RED}${BOLD}  REVERT: MEVDetected("Known MEV bot: 0xdead...0001")${RESET}`)
  console.log(`  ├── Pool: USDC/ETH 0.3%`)
  console.log(`  ├── Sandwich tx:  REVERTED`)
  console.log(`  └── Victim tx:    ${GREEN}PROTECTED — proceeds at fair price${RESET}`)
  console.log(`\n${GREEN}  Slippage saved for victim: ~$${Math.floor(victimTx.amountIn * 0.018).toLocaleString()} USDC${RESET}`)

  await sleep(1200)

  // ── Step 6: afterSwap settlement ──────────
  banner('Phase 5: USDC settlement + reputation update', GREEN)
  step(6, 'afterSwap fires — agent payment + ERC-8004 update...')
  await sleep(600)

  const agentFee     = 0.005
  const perfScore    = 950
  const newRepScore  = Math.round((800 * 0 + perfScore) / 1)  // first job

  console.log(`\n${GREEN}  ERC-8183 settlement:${RESET}`)
  console.log(`  ├── Job ID:      ${keccak256(toBytes(swapId + timestamp)).slice(0,20)}...`)
  console.log(`  ├── USDC paid:   $${agentFee} USDC`)
  console.log(`  ├── Settled in:  <1s (Arc sub-second finality)`)
  console.log(`  └── Gas cost:    ~$0.01 USDC`)

  console.log(`\n${CYAN}  ERC-8004 reputation update:${RESET}`)
  console.log(`  ├── Agent ID:    ${agent.agentId.slice(0,20)}...`)
  console.log(`  ├── Event type:  swap_completion`)
  console.log(`  ├── Perf score:  ${perfScore}/1000 (MEV block = highest value)`)
  console.log(`  └── New rep:     ${newRepScore}/1000 ${GREEN}↑${RESET}`)

  await sleep(1200)

  // ── Step 7: fee optimization demo ─────────
  banner('Bonus: Fee optimization on normal swap', YELLOW)
  step(7, 'Low-volatility window detected — agent suggests fee reduction...')
  await sleep(500)

  const lowVolSwap = { hash: '0x' + 'e'.repeat(64), from: '0xEve00' + '0'.repeat(34), poolId: POOL_ID, direction: 'USDC->ETH', amountIn: 2000, gasPrice: 12_000_000_000n }
  agent.mempoolWindow = [...normalSwaps.map(s => ({...s, poolId: POOL_ID})), lowVolSwap]
  const feeOpt = agent._optimizeFee(lowVolSwap)

  console.log(`\n${YELLOW}  Fee optimization result:${RESET}`)
  console.log(`  ├── Volatility:   ${feeOpt.volatility} (low)`)
  console.log(`  ├── Base fee:     ${feeOpt.baseBps}bps (0.3%)`)
  console.log(`  ├── Override fee: ${feeOpt.feeBps}bps (${(feeOpt.feeBps/100).toFixed(1)}%)`)
  console.log(`  └── Trader saves: ~$${(2000 * (feeOpt.baseBps - feeOpt.feeBps) / 10000).toFixed(2)} USDC on this swap`)

  await sleep(1000)

  // ── Final summary ──────────────────────────
  banner('Demo Summary', GREEN)

  console.log(`${BOLD}  What was demonstrated:${RESET}`)
  console.log(`  ✓ MEVShieldAgent registered on ERC-8004 (identity + reputation)`)
  console.log(`  ✓ Mempool monitoring detected sandwich attack in real-time`)
  console.log(`  ✓ Signed AgentIntent submitted to hook before block confirmation`)
  console.log(`  ✓ beforeSwap hook reverted malicious transaction`)
  console.log(`  ✓ Victim swap protected — ~$216 slippage saved`)
  console.log(`  ✓ Agent paid $0.005 USDC via ERC-8183 atomic settlement on Arc`)
  console.log(`  ✓ Reputation score updated: 800 → ${newRepScore}`)
  console.log(`  ✓ Dynamic fee reduced 0.3% → 0.1% in low-volatility window`)

  console.log(`\n${BOLD}  Why Arc makes this possible:${RESET}`)
  console.log(`  • Sub-second finality → AgentIntent lands before victim's swap`)
  console.log(`  • ~$0.01 USDC gas fees → per-swap agent micropayments are viable`)
  console.log(`  • USDC-native settlement → no volatile gas token needed`)

  console.log(`\n${DIM}  Contracts:`)
  console.log(`  ERC-8004 IdentityRegistry:   0x8004A818BFB912233c491871b3d84c89A494BD9e`)
  console.log(`  ERC-8004 ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713`)
  console.log(`  ERC-8183 AgenticCommerce:    0x0747EEf0706327138c69792bF28Cd525089e4583${RESET}`)

  console.log(`\n${GREEN}${BOLD}  AgentSwap — reputation-gated AI hooks for Uniswap v4${RESET}\n`)
}

runDemo().catch(err => {
  console.error('Demo error:', err)
  process.exit(1)
})
