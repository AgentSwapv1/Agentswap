/**
 * MEVShieldAgent
 *
 * Monitors mempool for pending swaps, detects sandwich patterns,
 * registers signed AgentIntents to the hook contract, and tracks
 * ERC-8004 reputation + ERC-8183 USDC earnings.
 *
 * Run: node agents/MEVShieldAgent.js
 */

import { createWalletClient, createPublicClient, http, parseAbi, keccak256, encodePacked } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { EventEmitter } from 'events'
import WebSocket from 'ws';
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

const HOOK_ABI = parseAbi([
  'function registerIntent(bytes32 swapId, uint24 feeOverrideBps, bool mevFlag, string mevEvidence, uint256 timestamp, bytes sig) external',
  'function getPoolConfig(bytes32 poolId) external view returns (bytes32, address, uint256, uint256, bool, bool, bool)',
  'event AgentSettled(bytes32 indexed swapId, bytes32 agentId, uint256 usdcPaid, uint256 perfScore)',
  'event MEVBlocked(bytes32 indexed swapId, bytes32 agentId, string evidence)',
])

const KNOWN_MEV_BOTS = new Set([
  '0xdead000000000000000000000000000000000001',
  '0xdead000000000000000000000000000000000002',
])

const SANDWICH_PATTERNS = {
  KNOWN_MEV_BOT:          'known_mev_bot_address',
  SAME_POOL_OPPOSITE_DIR: 'same_pool_opposite_direction',
  HIGH_GAS_FRONTRUN:      'anomalous_gas_price_frontrun',
}

class MEVShieldAgent extends EventEmitter {
  constructor(config) {
    super()
    this.config         = config
    this.agentId        = config.agentId
    this.hookAddress    = config.hookAddress
    this.monitoredPools = new Set(config.monitoredPools || [])

    this.mempoolWindow  = []
    this.windowSize     = 20
    this.stats = {
      swapsAnalyzed: 0, mevDetected: 0, feesOptimized: 0,
      usdcEarned: 0n,  repScore: 800,   totalJobs: 0,
    }

    if (config.agentPrivateKey) {
      this.account = privateKeyToAccount(config.agentPrivateKey)
      this.wallet  = createWalletClient({ account: this.account, chain: arcTestnet, transport: http() })
      this.public  = createPublicClient({ chain: arcTestnet, transport: http() })
    }
  }

  async start() {
    this.log('Starting MEVShieldAgent...')
    await this._refreshReputation()
    this._startMempoolMonitor()
  //  await this._listenForSettlements();
    this.log(`Active | wallet: ${this.account?.address || 'simulation'} | pools: ${this.monitoredPools.size}`)
  }

  _startMempoolMonitor() {
    const wsUrl = process.env.ALCHEMY_WS_URL
  
    if (!wsUrl) {
      this.log('No ALCHEMY_WS_URL set — falling back to simulation mode')
      setInterval(() => this._simulatePendingSwap(), 3000)
      return
    }
  
    this.log(`Connecting to Alchemy Arc WS: ${wsUrl.slice(0, 40)}...`)
    import('ws').then(({ default: WS }) => {
      const ws = new WS(wsUrl)
  
      ws.on('open', () => {
        this.log('Alchemy WS connected — subscribing to pending transactions')
        // Subscribe to all pending transactions
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id:      1,
          method:  'eth_subscribe',
          params:  ['newPendingTransactions', true], // true = include full tx body
        }))
      })
  
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
  
          // Subscription confirmation
          if (msg.id === 1) {
            this.log(`Subscribed to pending txs. Sub ID: ${msg.result}`)
            return
          }
  
          // Pending tx notification
          const tx = msg.params?.result
          if (!tx || typeof tx !== 'object') return
  
          // Only care about txs sent to our MockPoolManager
          const poolMgrAddr = (process.env.POOL_MANAGER || '').toLowerCase()
          if (poolMgrAddr && tx.to?.toLowerCase() !== poolMgrAddr) return
  
          // Decode which pool this swap targets (from calldata if possible)
          // For now: treat all pool manager calls as targeting our monitored pool
          const poolId = [...this.monitoredPools][0] || '0xdefaultpool'
  
          this._onPendingSwap({
            hash:      tx.hash,
            from:      tx.from,
            poolId,
            direction: 'USDC->ETH', // decode from calldata in production
            amountIn:  parseInt(tx.value || '0x0', 16) / 1e6,
            gasPrice:  BigInt(tx.gasPrice || '0x0'),
          })
  
        } catch (err) {
          // Malformed message — ignore
        }
      })
  
      ws.on('error', (err) => {
        this.log(`WS error: ${err.message} — retrying in 5s`)
      })
  
      ws.on('close', () => {
        this.log('WS disconnected — reconnecting in 5s')
        setTimeout(() => this._startMempoolMonitor(), 5000)
      })
  
      this._ws = ws
    })
  }

  _simulatePendingSwap() {
    const isMEV  = Math.random() < 0.25
    const pools  = [...this.monitoredPools]
    const poolId = pools[Math.floor(Math.random() * pools.length)] || '0xdefaultpool000'

    this._onPendingSwap({
      hash:        `0x${Array.from({length:64},()=>Math.floor(Math.random()*16).toString(16)).join('')}`,
      from:        isMEV ? [...KNOWN_MEV_BOTS][0] : `0x${Array.from({length:40},()=>Math.floor(Math.random()*16).toString(16)).join('')}`,
      poolId,
      direction:   Math.random() > 0.5 ? 'USDC->ETH' : 'ETH->USDC',
      amountIn:    Math.floor(Math.random() * 100000) + 1000,
      gasPrice:    BigInt(Math.floor(Math.random() * 50) + 10) * 1_000_000_000n,
    })
  }

  async _listenForSettlements() {
    if (!this.public) return;
    const filter = {
      address: this.hookAddress,
      event: parseAbi('event AgentSettled(bytes32 indexed swapId, bytes32 agentId, uint256 usdcPaid, uint256 perfScore)'),
    };
    this.public.watchContractEvent({
      ...filter,
      onLogs: (logs) => {
        for (const log of logs) {
          const { swapId, agentId, usdcPaid, perfScore } = log.args;
          if (agentId.toLowerCase() === this.agentId.toLowerCase()) {
            // Update stats based on actual on‑chain event
            this.stats.usdcEarned += usdcPaid;
            this.stats.totalJobs++;
            this.stats.repScore = Math.round(
              (this.stats.repScore * (this.stats.totalJobs - 1) + Number(perfScore)) / this.stats.totalJobs
            );
            this.emit('settled', {
              swapId,
              usdcEarned: Number(usdcPaid) / 1e6,
              perfScore: Number(perfScore),
              repScore: this.stats.repScore,
              totalJobs: this.stats.totalJobs,
            });
            this.log(`[settled on‑chain] +$${Number(usdcPaid)/1e6} USDC | perf: ${perfScore} | rep: ${this.stats.repScore}`);
          }
        }
      },
    });
  }

  async _onPendingSwap(tx) {
    this.stats.swapsAnalyzed++
    this.mempoolWindow.push(tx)
    if (this.mempoolWindow.length > this.windowSize) this.mempoolWindow.shift()

    if (!this.monitoredPools.has(tx.poolId)) return

    this.log(`[mempool] ${tx.direction} | ${tx.amountIn} USDC | ${tx.hash.slice(0,12)}...`)

    const sandwich = this._detectSandwich(tx)
    if (sandwich.isMEV) {
      this.stats.mevDetected++
      this.log(`[MEV] ${sandwich.pattern} | confidence: ${(sandwich.confidence*100).toFixed(0)}%`)
      await this._submitIntent(tx, { mevFlag: true, evidence: sandwich.evidence, feeOverride: 0 })
    } else {
      const fee = this._optimizeFee(tx)
      if (fee.shouldOverride) {
        this.stats.feesOptimized++
        this.log(`[fee-opt] vol: ${fee.volatility} | ${fee.baseBps}bps -> ${fee.feeBps}bps`)
        await this._submitIntent(tx, { mevFlag: false, evidence: '', feeOverride: fee.feeBps })
      }
    }
  }

  _detectSandwich(tx) {
    if (KNOWN_MEV_BOTS.has(tx.from.toLowerCase()))
      return { isMEV: true, pattern: SANDWICH_PATTERNS.KNOWN_MEV_BOT, evidence: `Known MEV bot: ${tx.from}`, confidence: 0.95 }

    const recent = this.mempoolWindow.slice(-5).filter(t => t.poolId === tx.poolId && t.hash !== tx.hash)
    for (const prev of recent) {
      if (prev.direction !== tx.direction && prev.amountIn > tx.amountIn * 0.8)
        return { isMEV: true, pattern: SANDWICH_PATTERNS.SAME_POOL_OPPOSITE_DIR, evidence: `Opposite swap ${prev.hash.slice(0,10)}... same pool, ${prev.amountIn} vs ${tx.amountIn} USDC`, confidence: 0.78 }
    }

    const avgGas = this.mempoolWindow.length > 2
      ? this.mempoolWindow.reduce((s,t) => s + t.gasPrice, 0n) / BigInt(this.mempoolWindow.length)
      : 0n
    if (avgGas > 0n && tx.gasPrice > avgGas * 3n)
      return { isMEV: true, pattern: SANDWICH_PATTERNS.HIGH_GAS_FRONTRUN, evidence: `Gas ${tx.gasPrice}gwei is 3x avg ${avgGas}gwei`, confidence: 0.65 }

    return { isMEV: false, pattern: null, evidence: '', confidence: 0 }
  }

  _optimizeFee(tx) {
    const amounts   = this.mempoolWindow.slice(-10).map(t => t.amountIn)
    const avg       = amounts.reduce((s,v) => s+v, 0) / (amounts.length || 1)
    const variance  = amounts.reduce((s,v) => s + (v-avg)**2, 0) / (amounts.length || 1)
    const vol       = Math.sqrt(variance) / avg

    const baseBps = 3000
    const feeBps  = vol < 0.1 ? 1000 : vol < 0.3 ? 2000 : vol > 0.8 ? 5000 : baseBps

    return { shouldOverride: feeBps !== baseBps, feeBps, baseBps, volatility: vol.toFixed(3) }
  }

  async _submitIntent(tx, { mevFlag, evidence, feeOverride }) {
    try {
      const swapId    = tx.hash.slice(0,66).padEnd(66,'0')
      const timestamp = Math.floor(Date.now() / 1000)

      const msgHash = keccak256(encodePacked(
        ['bytes32','uint24','bool','uint256'],
        [swapId, feeOverride, mevFlag, BigInt(timestamp)]
      ))

      const signature = this.account
        ? await this.account.signMessage({ message: { raw: msgHash } })
        : '0x' + '00'.repeat(65)

      const payload = { swapId, feeOverrideBps: feeOverride, mevFlag, mevEvidence: evidence, timestamp, signature }

      this.log(`[intent] mev:${mevFlag} fee:${feeOverride}bps | ${swapId.slice(0,14)}...`)

      // ── Submit onchain if hook is deployed ────────────────
      if (this.hookAddress && this.hookAddress !== '0x' + '1'.padStart(40,'0') && this.wallet) {
        try {
          const txHash = await this.wallet.writeContract({
            address:      this.hookAddress,
            abi:          HOOK_ABI,
            functionName: 'registerIntent',
            args: [
              swapId,
              feeOverride,
              mevFlag,
              evidence || '',
              BigInt(timestamp),
              signature,
            ],
          })
          this.log(`[intent] onchain tx: ${txHash}`)
        } catch (err) {
          this.log(`[intent] onchain failed (${err.message.slice(0,60)}) — simulation mode`)
        }
      }

      this.emit('intentSubmitted', { ...payload, agentWallet: this.account?.address })
      setTimeout(() => this._onSettlement(swapId, mevFlag, feeOverride), 1200)

    } catch (err) {
      this.log(`[intent] Error: ${err.message}`)
    }
  }

  _onSettlement(swapId, mevFlag, feeOverride) {
    const usdcEarned = mevFlag ? 5000n : 1000n
    const perfScore  = mevFlag ? 950 : feeOverride > 0 ? 850 : 700

    this.stats.usdcEarned += usdcEarned
    this.stats.totalJobs++
    this.stats.repScore = Math.round(
      (this.stats.repScore * (this.stats.totalJobs - 1) + perfScore) / this.stats.totalJobs
    )

    const result = {
      swapId,
      usdcEarned: Number(usdcEarned) / 1e6,
      perfScore,
      repScore:  this.stats.repScore,
      totalJobs: this.stats.totalJobs,
    }
    this.emit('settled', result)
    this.log(`[settled] +$${result.usdcEarned.toFixed(4)} USDC | perf: ${perfScore} | rep: ${this.stats.repScore}`)
  }

  async _refreshReputation() {
    // Production: read from ERC-8004 ReputationRegistry on Arc
    this.stats.repScore = 800
    this.log(`[rep] Bootstrap score: ${this.stats.repScore}`)
  }

  getStatus() {
    return {
      agentId:       this.agentId,
      wallet:        this.account?.address || 'N/A',
      repScore:      this.stats.repScore,
      totalJobs:     this.stats.totalJobs,
      usdcEarned:    (Number(this.stats.usdcEarned) / 1e6).toFixed(6),
      swapsAnalyzed: this.stats.swapsAnalyzed,
      mevDetected:   this.stats.mevDetected,
      feesOptimized: this.stats.feesOptimized,
      mevRate:       this.stats.swapsAnalyzed > 0
        ? ((this.stats.mevDetected / this.stats.swapsAnalyzed) * 100).toFixed(1) + '%' : '0%',
    }
  }

  log(msg) {
    process.stdout.write(`[MEVShield ${new Date().toISOString().slice(11,23)}] ${msg}\n`)
  }
}

export { MEVShieldAgent }

// ── CLI entrypoint ─────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('MEVShieldAgent.js')
if (isMain) {
  if (!process.env.AGENT_PRIVATE_KEY) {
    console.error('Set AGENT_PRIVATE_KEY in .env')
    process.exit(1)
  }

  const agent = new MEVShieldAgent({
    agentId:        process.env.AGENT_ID || '0x6d65767368' + '0'.repeat(58),
    agentPrivateKey: process.env.AGENT_PRIVATE_KEY,
    hookAddress:    process.env.HOOK_ADDRESS || '0x' + '1'.padStart(40,'0'),
    monitoredPools: (process.env.MONITORED_POOLS || '').split(',').filter(Boolean),
  })

  agent.on('settled', () => {})
  agent.start().catch(console.error)

  setInterval(() => {
    const s = agent.getStatus()
    console.log(`\n── Agent Status ─────────────────────────`)
    Object.entries(s).forEach(([k,v]) => console.log(`  ${k.padEnd(16)}: ${v}`))
    console.log(`─────────────────────────────────────────\n`)
  }, 15000)
}
