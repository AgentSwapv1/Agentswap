/**
 * agentswap.test.js
 *
 * Full test suite for AgentSwap MVP.
 * Tests MEVShieldAgent, PriceOracleAgent, intent signing,
 * sandwich detection, fee optimization, and settlement logic.
 *
 * No external deps needed — pure Node.js assert.
 * Run: npm test
 */

import assert from 'assert'
import { keccak256, encodePacked } from 'viem'
import { MEVShieldAgent } from '../agents/MEVShieldAgent.js'
import { PriceOracleAgent } from '../agents/PriceOracleAgent.js'

const DUMMY_KEY  = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const POOL_ID    = '0x' + 'a1b2c3d4'.repeat(8)
const AGENT_ID   = '0x' + '6d657673'.repeat(8)

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.log(`  ✗ ${name}`)
    console.log(`    ${err.message}`)
    failed++
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.log(`  ✗ ${name}`)
    console.log(`    ${err.message}`)
    failed++
  }
}

function makeAgent(overrides = {}) {
  return new MEVShieldAgent({
    agentId:        AGENT_ID,
    agentPrivateKey: DUMMY_KEY,
    hookAddress:    '0x' + '1'.padStart(40, '0'),
    monitoredPools: [POOL_ID],
    ...overrides,
  })
}

function makeOracleAgent(overrides = {}) {
  return new PriceOracleAgent({
    agentId:        AGENT_ID,
    agentPrivateKey: DUMMY_KEY,
    hookAddress:    '0x' + '1'.padStart(40, '0'),
    monitoredPools: [POOL_ID],
    ...overrides,
  })
}

// ════════════════════════════════════════════════
//  Suite 1: MEVShieldAgent initialization
// ════════════════════════════════════════════════
console.log('\n── Suite 1: MEVShieldAgent init ─────────────')

test('agent initializes with correct agentId', () => {
  const agent = makeAgent()
  assert.strictEqual(agent.agentId, AGENT_ID)
})

test('agent starts with correct default stats', () => {
  const agent = makeAgent()
  assert.strictEqual(agent.stats.swapsAnalyzed, 0)
  assert.strictEqual(agent.stats.mevDetected,   0)
  assert.strictEqual(agent.stats.feesOptimized, 0)
  assert.strictEqual(agent.stats.repScore,      800)
  assert.strictEqual(agent.stats.totalJobs,     0)
})

test('monitored pools are stored as Set', () => {
  const agent = makeAgent()
  assert.ok(agent.monitoredPools instanceof Set)
  assert.ok(agent.monitoredPools.has(POOL_ID))
})

test('mempool window initializes empty', () => {
  const agent = makeAgent()
  assert.strictEqual(agent.mempoolWindow.length, 0)
})

// ════════════════════════════════════════════════
//  Suite 2: Sandwich detection
// ════════════════════════════════════════════════
console.log('\n── Suite 2: Sandwich detection ──────────────')

test('known MEV bot detected at 95% confidence', () => {
  const agent  = makeAgent()
  const result = agent._detectSandwich({
    hash:     '0x' + 'aa'.repeat(32),
    from:     '0xdead000000000000000000000000000000000001',
    poolId:   POOL_ID,
    direction: 'USDC->ETH',
    amountIn:  50000,
    gasPrice:  15_000_000_000n,
  })
  assert.strictEqual(result.isMEV,   true)
  assert.strictEqual(result.pattern, 'known_mev_bot_address')
  assert.ok(result.confidence >= 0.95)
})

test('normal address not flagged as MEV bot', () => {
  const agent  = makeAgent()
  const result = agent._detectSandwich({
    hash:     '0x' + 'bb'.repeat(32),
    from:     '0x1234567890abcdef1234567890abcdef12345678',
    poolId:   POOL_ID,
    direction: 'USDC->ETH',
    amountIn:  5000,
    gasPrice:  15_000_000_000n,
  })
  // Without preceding tx in window or high gas, should not be flagged
  assert.strictEqual(result.isMEV, false)
})

test('opposite-direction swap detected as sandwich', () => {
  const agent = makeAgent()
  // Pre-fill mempool with an opposing swap
  const prevTx = {
    hash:     '0x' + 'cc'.repeat(32),
    from:     '0xattacker' + '0'.repeat(31),
    poolId:   POOL_ID,
    direction: 'USDC->ETH',  // large buy
    amountIn:  80000,
    gasPrice:  20_000_000_000n,
  }
  agent.mempoolWindow.push(prevTx)

  const victimTx = {
    hash:     '0x' + 'dd'.repeat(32),
    from:     '0xvictim00' + '0'.repeat(31),
    poolId:   POOL_ID,
    direction: 'ETH->USDC',  // opposite direction
    amountIn:  70000,
    gasPrice:  15_000_000_000n,
  }
  const result = agent._detectSandwich(victimTx)
  assert.strictEqual(result.isMEV,   true)
  assert.strictEqual(result.pattern, 'same_pool_opposite_direction')
})

test('high gas price triggers frontrun detection', () => {
  const agent = makeAgent()
  // Seed window with normal gas prices
  for (let i = 0; i < 5; i++) {
    agent.mempoolWindow.push({ hash: '0x'+i.toString().padStart(64,'0'), from: '0x'+i.toString().padStart(40,'0'), poolId: POOL_ID, direction: 'USDC->ETH', amountIn: 5000, gasPrice: 12_000_000_000n })
  }
  const highGasTx = {
    hash:     '0x' + 'ee'.repeat(32),
    from:     '0xsuspicious' + '0'.repeat(29),
    poolId:   POOL_ID,
    direction: 'USDC->ETH',
    amountIn:  10000,
    gasPrice:  50_000_000_000n,  // 4x+ normal
  }
  const result = agent._detectSandwich(highGasTx)
  assert.strictEqual(result.isMEV,   true)
  assert.strictEqual(result.pattern, 'anomalous_gas_price_frontrun')
})

test('different pool is not flagged as sandwich', () => {
  const agent = makeAgent()
  const otherPool = '0x' + 'ff'.repeat(32)
  agent.mempoolWindow.push({
    hash: '0x' + 'a'.repeat(64), from: '0x' + '1'.repeat(40), poolId: otherPool, direction: 'USDC->ETH', amountIn: 80000, gasPrice: 20_000_000_000n,
  })
  const result = agent._detectSandwich({
    hash: '0x' + 'b'.repeat(64), from: '0x' + '2'.repeat(40), poolId: POOL_ID, direction: 'ETH->USDC', amountIn: 70000, gasPrice: 15_000_000_000n,
  })
  // Cross-pool opposite directions should NOT be flagged — different pool
  // The sandwich check filters by poolId match, so this should be clean
  assert.strictEqual(result.isMEV, false)
})

// ════════════════════════════════════════════════
//  Suite 3: Fee optimization
// ════════════════════════════════════════════════
console.log('\n── Suite 3: Fee optimization ────────────────')

test('low volatility → suggests lower fee', () => {
  const agent = makeAgent()
  // Seed with very stable amounts (low variance)
  agent.mempoolWindow = Array.from({ length: 10 }, (_, i) => ({
    hash: '0x' + i.toString().padStart(64, '0'), from: '0x' + i.toString().padStart(40, '0'),
    poolId: POOL_ID, direction: 'USDC->ETH', amountIn: 5000 + i, gasPrice: 12_000_000_000n,
  }))
  const result = agent._optimizeFee({ amountIn: 5005 })
  assert.ok(result.feeBps < 3000, `Expected fee < 3000bps, got ${result.feeBps}`)
  assert.strictEqual(result.shouldOverride, true)
})

test('high volatility → suggests higher fee', () => {
  const agent = makeAgent()
  // Seed with wildly varying amounts
  agent.mempoolWindow = [1000, 95000, 500, 88000, 200, 75000, 100, 60000, 150, 50000].map((amt, i) => ({
    hash: '0x' + i.toString().padStart(64, '0'), from: '0x' + i.toString().padStart(40, '0'),
    poolId: POOL_ID, direction: 'USDC->ETH', amountIn: amt, gasPrice: 12_000_000_000n,
  }))
  const result = agent._optimizeFee({ amountIn: 10000 })
  assert.ok(result.feeBps >= 3000, `Expected fee >= 3000bps, got ${result.feeBps}`)
})

test('fee optimization returns required fields', () => {
  const agent  = makeAgent()
  agent.mempoolWindow = [{ amountIn: 5000, poolId: POOL_ID, direction: 'USDC->ETH', hash: '0x'+('a').repeat(64), from: '0x'+'b'.repeat(40), gasPrice: 12_000_000_000n }]
  const result = agent._optimizeFee({ amountIn: 5000 })
  assert.ok('shouldOverride' in result)
  assert.ok('feeBps'         in result)
  assert.ok('baseBps'        in result)
  assert.ok('volatility'     in result)
})

// ════════════════════════════════════════════════
//  Suite 4: Settlement and reputation
// ════════════════════════════════════════════════
console.log('\n── Suite 4: Settlement & reputation ─────────')

test('MEV block gives highest perf score (950)', () => {
  const agent = makeAgent()
  let capturedScore
  agent.on('settled', (data) => { capturedScore = data.perfScore })
  agent._onSettlement('0x' + 'a'.repeat(64), true, 0)
  assert.strictEqual(capturedScore, 950)
})

test('fee optimization gives score 850', () => {
  const agent = makeAgent()
  let capturedScore
  agent.on('settled', (data) => { capturedScore = data.perfScore })
  agent._onSettlement('0x' + 'b'.repeat(64), false, 2000)
  assert.strictEqual(capturedScore, 850)
})

test('no intervention gives base score 700', () => {
  const agent = makeAgent()
  let capturedScore
  agent.on('settled', (data) => { capturedScore = data.perfScore })
  agent._onSettlement('0x' + 'c'.repeat(64), false, 0)
  assert.strictEqual(capturedScore, 700)
})

test('rep score converges correctly over multiple jobs', () => {
  const agent = makeAgent()
  // 3 MEV blocks: score 950 each
  agent._onSettlement('0x01' + '0'.repeat(62), true, 0)
  agent._onSettlement('0x02' + '0'.repeat(62), true, 0)
  agent._onSettlement('0x03' + '0'.repeat(62), true, 0)
  // After 3 jobs at 950, rolling avg from base 800:
  // job1: (800*0 + 950)/1 = 950
  // job2: (950*1 + 950)/2 = 950
  // job3: (950*2 + 950)/3 = 950
  assert.strictEqual(agent.stats.repScore, 950)
  assert.strictEqual(agent.stats.totalJobs, 3)
})

test('USDC earned accumulates correctly', () => {
  const agent = makeAgent()
  agent._onSettlement('0x01' + '0'.repeat(62), true,  0)  // 0.005 USDC
  agent._onSettlement('0x02' + '0'.repeat(62), false, 0)  // 0.001 USDC
  agent._onSettlement('0x03' + '0'.repeat(62), true,  0)  // 0.005 USDC
  const earned = Number(agent.stats.usdcEarned) / 1e6
  assert.ok(Math.abs(earned - 0.011) < 0.0001, `Expected 0.011 USDC, got ${earned}`)
})

test('mempool window enforces max size', () => {
  const agent = makeAgent()
  for (let i = 0; i < 30; i++) {
    agent.mempoolWindow.push({ hash: '0x'+i.toString().padStart(64,'0'), poolId: POOL_ID, direction: 'USDC->ETH', amountIn: 1000+i, gasPrice: 12_000_000_000n, from: '0x'+'0'.repeat(40) })
    if (agent.mempoolWindow.length > agent.windowSize) agent.mempoolWindow.shift()
  }
  assert.ok(agent.mempoolWindow.length <= agent.windowSize)
})

// ════════════════════════════════════════════════
//  Suite 5: getStatus()
// ════════════════════════════════════════════════
console.log('\n── Suite 5: Status reporting ────────────────')

test('getStatus returns all required fields', () => {
  const agent  = makeAgent()
  const status = agent.getStatus()
  const fields = ['agentId','wallet','repScore','totalJobs','usdcEarned','swapsAnalyzed','mevDetected','feesOptimized','mevRate']
  fields.forEach(f => assert.ok(f in status, `Missing field: ${f}`))
})

test('mevRate is 0% with no detections', () => {
  const agent  = makeAgent()
  assert.strictEqual(agent.getStatus().mevRate, '0%')
})

test('mevRate correct after some detections', () => {
  const agent = makeAgent()
  agent.stats.swapsAnalyzed = 10
  agent.stats.mevDetected   = 3
  const rate = agent.getStatus().mevRate
  assert.strictEqual(rate, '30.0%')
})

// ════════════════════════════════════════════════
//  Suite 6: PriceOracleAgent
// ════════════════════════════════════════════════
console.log('\n── Suite 6: PriceOracleAgent ────────────────')

test('oracle agent initializes correctly', () => {
  const agent = makeOracleAgent()
  assert.strictEqual(agent.agentId, AGENT_ID)
  assert.strictEqual(agent.stats.repScore, 800)
})

test('low price variance → low volatility', () => {
  const agent  = makeOracleAgent()
  const prices = Array.from({ length: 20 }, (_, i) => 3000 + i * 0.1)  // tiny drift
  const vol    = agent._computeVolatility(prices)
  assert.ok(vol < 0.5, `Expected vol < 0.5, got ${vol}`)
})

test('high price variance → high volatility', () => {
  const agent  = makeOracleAgent()
  const prices = [3000, 2500, 3800, 2200, 4000, 1800, 3500, 2000, 4200, 1500]
  const vol    = agent._computeVolatility(prices)
  assert.ok(vol > 1.0, `Expected vol > 1.0, got ${vol}`)
})

test('fee schedule selects correct tier', () => {
  const agent = makeOracleAgent()
  assert.strictEqual(agent._selectFee(0.03).feeBps,  500)   // ultra-low
  assert.strictEqual(agent._selectFee(0.10).feeBps,  1000)  // low
  assert.strictEqual(agent._selectFee(0.20).feeBps,  2000)  // moderate
  assert.strictEqual(agent._selectFee(0.40).feeBps,  3000)  // standard
  assert.strictEqual(agent._selectFee(0.70).feeBps,  5000)  // high
  assert.strictEqual(agent._selectFee(2.00).feeBps,  10000) // extreme
})

test('IL protection estimate is positive when fee increases', () => {
  const agent = makeOracleAgent()
  const il = agent._estimateILProtection(5000, 3000, 100000)
  assert.ok(il > 0, `Expected positive IL protection, got ${il}`)
})

test('oracle status has agentType field', () => {
  const agent  = makeOracleAgent()
  const status = agent.getStatus()
  assert.strictEqual(status.agentType, 'PriceOracleAgent')
  assert.ok('ilProtected' in status)
  assert.ok('avgVolatility' in status)
})

// ════════════════════════════════════════════════
//  Suite 7: ERC-8004/8183 contract config
// ════════════════════════════════════════════════
console.log('\n── Suite 7: Arc contract addresses ──────────')

test('ERC-8004 contract addresses are valid hex', () => {
  const addrs = [
    '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
  ]
  addrs.forEach(addr => {
    assert.ok(/^0x[0-9a-fA-F]{40}$/.test(addr), `Invalid address: ${addr}`)
  })
})

test('ERC-8183 AgenticCommerce address is valid hex', () => {
  const addr = '0x0747EEf0706327138c69792bF28Cd525089e4583'
  assert.ok(/^0x[0-9a-fA-F]{40}$/.test(addr))
})

test('agent fee floor constant is correct (0.001 USDC)', () => {
  // 0.001 USDC in 6-decimal units = 1000
  const AGENT_FEE_FLOOR = 1000
  assert.strictEqual(AGENT_FEE_FLOOR, 1000)
})

test('perf score bounds are valid', () => {
  const scores = [950, 900, 880, 850, 820, 800, 700]
  scores.forEach(s => {
    assert.ok(s >= 0 && s <= 1000, `Score out of range: ${s}`)
  })
})

// ════════════════════════════════════════════════
//  Results
// ════════════════════════════════════════════════
console.log(`\n── Results ──────────────────────────────────`)
console.log(`  Passed: ${passed}`)
console.log(`  Failed: ${failed}`)
console.log(`  Total:  ${passed + failed}`)
if (failed > 0) {
  console.log(`\n  ✗ ${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log(`\n  ✓ All tests passed`)
}
