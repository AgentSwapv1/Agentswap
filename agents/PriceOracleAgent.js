/**
 * PriceOracleAgent
 *
 * Second agent type for AgentSwap.
 * Monitors on-chain TWAP, computes volatility, and submits
 * fee override suggestions to the hook. Gets paid per swap improved.
 *
 * ShieldSuite insight: this agent *protects LP principal* from
 * impermanent loss by keeping fee revenue aligned with volatility.
 * High vol → raise fee → LP earns more per swap to offset IL.
 * Low vol  → lower fee → attract more volume → more total fee revenue.
 *
 * Run: node agents/PriceOracleAgent.js
 */

import { createPublicClient, createWalletClient, http, parseAbi, keccak256, encodePacked } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { EventEmitter } from 'events'
import dotenv from 'dotenv'
dotenv.config()

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: {
      http: [process.env.ARC_RPC_URL || 'https://arc-testnet.g.alchemy.com/v2/7cluOS8jdf6j7UXBzAhwx'],
      webSocket: [process.env.ALCHEMY_WS_URL || 'wss://arc-testnet.g.alchemy.com/v2/7cluOS8jdf6j7UXBzAhwx'],
    }
  },
}
// Fee tiers (bps) mapped to volatility buckets
const FEE_SCHEDULE = [
  { maxVol: 0.05,  feeBps: 500,   label: 'ultra-low'  },  // 0.05%
  { maxVol: 0.15,  feeBps: 1000,  label: 'low'        },  // 0.1%
  { maxVol: 0.30,  feeBps: 2000,  label: 'moderate'   },  // 0.2%
  { maxVol: 0.60,  feeBps: 3000,  label: 'standard'   },  // 0.3%
  { maxVol: 1.00,  feeBps: 5000,  label: 'high'       },  // 0.5%
  { maxVol: Infinity, feeBps: 10000, label: 'extreme' },   // 1.0%
]

const HOOK_ABI = parseAbi([
  'function registerIntent(bytes32 swapId, uint24 feeOverrideBps, bool mevFlag, string mevEvidence, uint256 timestamp, bytes sig) external',
  'event AgentSettled(bytes32 indexed swapId, bytes32 agentId, uint256 usdcPaid, uint256 perfScore)',
])

class PriceOracleAgent extends EventEmitter {
  constructor(config) {
    super()
    this.agentId        = config.agentId
    this.hookAddress    = config.hookAddress
    this.monitoredPools = new Set(config.monitoredPools || [])

    // Sliding price window per pool: last 20 TWAP observations
    this.priceWindows = {}  // poolId → number[]

    this.stats = {
      swapsAnalyzed:  0,
      feesSubmitted:  0,
      feesAccepted:   0,
      usdcEarned:     0,
      repScore:       800,
      totalJobs:      0,
      avgVolatility:  0,
      ilProtected:    0,     // estimated USDC of IL prevented for LPs
    }

    if (config.agentPrivateKey) {
      this.account = privateKeyToAccount(config.agentPrivateKey)
      this.wallet  = createWalletClient({ account: this.account, chain: arcTestnet, transport: http() })
      this.public  = createPublicClient({ chain: arcTestnet, transport: http() })
    }
  }



  async start() {
    this.log('Starting PriceOracleAgent...')
    this._initPriceWindows()
    this._startPriceSimulator()
    this.log(`Active | pools: ${this.monitoredPools.size}`)
  }

  _initPriceWindows() {
    for (const poolId of this.monitoredPools) {
      // Seed with a realistic USDC/ETH price baseline (~3000)
      this.priceWindows[poolId] = Array.from({ length: 10 }, (_, i) =>
        3000 + Math.sin(i * 0.5) * 50 + Math.random() * 20
      )
    }
  }

  _startPriceSimulator() {
    // Production: subscribe to Arc node for pool PriceUpdated events
    // MVP: simulate TWAP tick updates every 2s
    setInterval(() => this._simulatePriceTick(), 3000)
    this.log('Price feed active (simulation mode)')
  }

  _simulatePriceTick() {
    for (const poolId of this.monitoredPools) {
      const window = this.priceWindows[poolId] || []
      const last   = window[window.length - 1] || 3000

      // Geometric Brownian Motion (simplified)
      const drift     = 0.0001
      const sigma     = 0.008 + Math.random() * 0.012
      const shock     = (Math.random() - 0.5) * 2
      const newPrice  = last * Math.exp(drift + sigma * shock)

      window.push(newPrice)
      if (window.length > 20) window.shift()
      this.priceWindows[poolId] = window

      this._onPriceUpdate(poolId, newPrice, window)
    }
  }

  _onPriceUpdate(poolId, price, window) {
    this.stats.swapsAnalyzed++

    const vol = this._computeVolatility(window)
    const { feeBps, label } = this._selectFee(vol)

    // Update rolling avg volatility
    this.stats.avgVolatility = (this.stats.avgVolatility * 0.95 + vol * 0.05)

    const currentFee  = 3000  // pool's default fee bps
    const shouldOverride = Math.abs(feeBps - currentFee) > 200  // only suggest if diff > 2bps

    if (shouldOverride) {
      const ilProtection = this._estimateILProtection(feeBps, currentFee, 100000)
      this.stats.ilProtected += ilProtection

      this.log(`[price] $${price.toFixed(2)} | vol: ${(vol*100).toFixed(2)}% | regime: ${label} | fee: ${feeBps}bps (was ${currentFee}bps)`)
      this._submitFeeIntent(poolId, feeBps, vol, label)
    }
  }

  // Realized volatility (annualized log-return std dev)
  _computeVolatility(prices) {
    if (prices.length < 2) return 0
    const logReturns = []
    for (let i = 1; i < prices.length; i++) {
      logReturns.push(Math.log(prices[i] / prices[i - 1]))
    }
    const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length
    const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / logReturns.length
    const periodsPerHour = 3600 / 2  // 1800 ticks per hour at 2s interval
    return Math.sqrt(variance * periodsPerHour)
  }

  _selectFee(vol) {
    return FEE_SCHEDULE.find(tier => vol <= tier.maxVol) || FEE_SCHEDULE[FEE_SCHEDULE.length - 1]
  }

  // Estimate USDC of IL prevented for LPs by charging higher fee in high-vol conditions
  // IL ≈ 2*sqrt(p1/p0) - (p1/p0) - 1 — simplified; fee income offsets this
  _estimateILProtection(newFeeBps, baseBps, poolTVL) {
    const extraFeeFraction = (newFeeBps - baseBps) / 10000
    return extraFeeFraction * poolTVL * 0.01  // 1% of TVL * extra fee fraction
  }

  async _submitFeeIntent(poolId, feeBps, vol, label) {
    this.stats.feesSubmitted++
    const swapId = keccak256(encodePacked(['bytes32', 'uint256'], [poolId, BigInt(Date.now())]))
    const timestamp = Math.floor(Date.now() / 1000)
const innerHash = keccak256(encodePacked(
  ['bytes32', 'uint24', 'bool', 'uint256'],
  [swapId, feeBps, false, BigInt(timestamp)]
))
const signature = await this.account.signMessage({ message: { raw: innerHash } })
  
    this.log(`[intent] fee: ${feeBps}bps | regime: ${label} | ${swapId.slice(0,14)}...`)
  
// ── Submit on-chain ──
if (this.hookAddress && this.hookAddress !== '0x' + '1'.padStart(40, '0') && this.wallet) {
  if (this._txPending) {
    this.log(`[intent] skipping — previous tx still pending`)
    return
  }

  try {
    this._txPending = true
    const txHash = await this.wallet.writeContract({
      address:      this.hookAddress,
      abi:          HOOK_ABI,
      functionName: 'registerIntent',
      chain:        arcTestnet,
      args: [
        swapId,
        feeBps,
        false,
        '',
        BigInt(timestamp),
        signature,
      ],
    })
    this.log(`[intent] onchain tx: ${txHash}`)

    const receipt = await this.public.waitForTransactionReceipt({ hash: txHash })
    this.log(`[intent] confirmed block: ${receipt.blockNumber} | status: ${receipt.status}`)
    this._txPending = false
    if (receipt.status === 'success') {
      this._onSettlement(swapId, feeBps, 0)
    }

  } catch (err) {
    this._txPending = false
    this.log(`[intent] onchain failed (${err.message.slice(0, 80)}) — simulation mode`)
  }
}
  
    this.emit('intentSubmitted', { swapId, feeOverrideBps: feeBps, mevFlag: false })
  }

  _onSettlement(swapId, feeBps, vol) {
    this.stats.feesAccepted++
    this.stats.totalJobs++

    const usdcEarned = 0.001  // $0.001 per accepted fee optimization
    this.stats.usdcEarned += usdcEarned

    const perfScore = feeBps > 3000 ? 880 : feeBps < 3000 ? 860 : 820
    this.stats.repScore = Math.round(
      (this.stats.repScore * (this.stats.totalJobs - 1) + perfScore) / this.stats.totalJobs
    )

    this.emit('settled', {
      swapId,
      usdcEarned,
      perfScore,
      repScore: this.stats.repScore,
      totalJobs: this.stats.totalJobs,
      feeBps,
    })

    this.log(`[settled] +$${usdcEarned.toFixed(4)} | perf: ${perfScore} | rep: ${this.stats.repScore}`)
  }

  getStatus() {
    return {
      agentId:       this.agentId,
      agentType:     'PriceOracleAgent',
      wallet:        this.account?.address || 'N/A',
      repScore:      this.stats.repScore,
      totalJobs:     this.stats.totalJobs,
      usdcEarned:    this.stats.usdcEarned.toFixed(6),
      swapsAnalyzed: this.stats.swapsAnalyzed,
      feesSubmitted: this.stats.feesSubmitted,
      feesAccepted:  this.stats.feesAccepted,
      avgVolatility: (this.stats.avgVolatility * 100).toFixed(2) + '%',
      ilProtected:   '$' + this.stats.ilProtected.toFixed(2) + ' USDC est.',
    }
  }

  log(msg) {
    process.stdout.write(`[OracleAgent ${new Date().toISOString().slice(11, 23)}] ${msg}\n`)
  }
}

export { PriceOracleAgent }

const isMain = process.argv[1]?.endsWith('PriceOracleAgent.js')
if (isMain) {
  const agent = new PriceOracleAgent({
    agentId:        process.env.AGENT_ID || '0x6f7261636c650000' + '0'.repeat(50),
    agentPrivateKey: process.env.AGENT_PRIVATE_KEY,
    hookAddress:    process.env.HOOK_ADDRESS || '0x' + '1'.padStart(40, '0'),
    monitoredPools: (process.env.MONITORED_POOLS || '').split(',').filter(Boolean),
  })
  agent.start().catch(console.error)
  setInterval(() => {
    const s = agent.getStatus()
    console.log('\n── PriceOracleAgent Status ──────────────')
    Object.entries(s).forEach(([k, v]) => console.log(`  ${k.padEnd(16)}: ${v}`))
    console.log('─────────────────────────────────────────\n')
  }, 20000)
}
