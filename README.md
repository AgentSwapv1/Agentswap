# AgentSwap

**Reputation-gated AI agent hooks for Uniswap v4 — MEV defense + dynamic fee optimization, settled in USDC.**

## What it does

AgentSwap embeds AI agents directly into the Uniswap v4 swap lifecycle via hooks. Every swap:

1. Is **screened by a reputation-scored agent** (ERC-8004 gate — agents below threshold are excluded)
2. Triggers either **MEV sandwich blocking** or **dynamic fee optimization**
3. **Pays the agent** in USDC via ERC-8183 atomic settlement on Arc (sub-cent gas, sub-second finality)
4. **Updates the agent's reputation** — good performance → higher score → more pool assignments → more earnings
---

## Architecture

```
Trader submits swap
  ↓
PoolManager.swap()
  ↓
AgentSwapHook.beforeSwap()
  ├─ ERC-8004: check agent rep score ≥ minRepScore (750)
  ├─ Read agent's pre-submitted AgentIntent (signed, prior block)
  ├─ If mevFlag=true  → REVERT (MEVDetected) — sandwich blocked
  └─ If feeOverride   → apply dynamic fee bps
  ↓
Swap executes in PoolManager
  ↓
AgentSwapHook.afterSwap()
  ├─ Compute slippage saved vs baseline
  ├─ ERC-8183: createJob + fundEscrow + completeJob (atomic)
  ├─ USDC released to agent wallet on Arc (<1s)
  └─ ERC-8004: recordEvent(agentId, jobId, perfScore)
```

---

## Agent types

### MEVShieldAgent (`agents/MEVShieldAgent.js`)
- Monitors mempool for pending swaps
- Detects sandwich patterns: known MEV bot addresses, opposite-direction swaps in same pool, anomalous gas prices
- Submits signed `AgentIntent(mevFlag=true)` to hook in prior block
- Earns $0.005 USDC per successful MEV block, perf score 950/1000

### PriceOracleAgent (`agents/PriceOracleAgent.js`)
- Tracks TWAP price window per pool
- Computes realized volatility (annualized log-return std dev)
- Maps volatility to optimal fee tier (0.05% → 1.0%)
- Submits `AgentIntent(feeOverrideBps=X)` when fee should change
- Earns $0.001 USDC per accepted fee optimization, perf score 850–880/1000

---

## ERC-8004 + ERC-8183 integration

| Standard | Role in AgentSwap |
|---|---|
| ERC-8004 IdentityRegistry | Agent registers capabilities: `["mev_detection", "fee_optimization"]` |
| ERC-8004 ReputationRegistry | Hook gates swap access by `getScore(agentId) ≥ minRepScore`. Score updated `afterSwap` |
| ERC-8183 AgenticCommerce | Atomic job creation + escrow + completion in `afterSwap`. Hook is evaluator (deterministic outcome) |

Arc testnet contracts:
```
IdentityRegistry:   0x8004A818BFB912233c491871b3d84c89A494BD9e
ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
ValidationRegistry: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
AgenticCommerce:    0x0747EEf0706327138c69792bF28Cd525089e4583
```

---

## Quick start

### Prerequisites
```bash
# Node.js >= 20.18.2
node --version

# Arc CLI
uv tool install git+https://github.com/the-canteen-dev/ARC-cli

# Circle CLI
npm install -g @circle-fin/cli
```

### 1. Install
```bash
git clone <repo>
cd agentswap
npm install
```

### 2. Configure
```bash
cp .env.example .env
# Add your Circle API key and entity secret
```

### 3. Set up Arc wallets
```bash
npm run setup:arc
# Creates deployer + agent wallets on Arc testnet
# Fund them at https://faucet.arc.testnet.circle.com
```

### 4. Configure Circle
```bash
npm run setup:circle
# Verifies USDC balances, prints funding instructions
```

### 5. Deploy hook
```bash
npm run deploy
# Deploys AgentSwapHook.sol to Arc testnet
# Configures pool with MEVShieldAgent
```

### 6. Run the demo
```bash
# Live sandwich simulation (showstopper demo)
npm run demo

# Or start the agents
npm run agent:mev      # MEVShieldAgent (terminal 1)
npm run agent:oracle   # PriceOracleAgent (terminal 2)
npm run dashboard      # Live dashboard at localhost:3000 (terminal 3)
```

### 7. Run tests
```bash
npm test
# 31 tests — MEVShieldAgent, PriceOracleAgent, detection, settlement, rep scoring
```

---

## Environment variables

```bash
# Circle credentials (required)
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=

# Arc testnet
ARC_RPC_URL=https://rpc.arc.testnet.circle.com

# Filled by npm run setup:arc
WALLET_SET_ID=
DEPLOYER_WALLET_ID=
DEPLOYER_ADDRESS=
AGENT_WALLET_ID=
AGENT_ADDRESS=
AGENT_ID=

# Filled by npm run deploy
HOOK_ADDRESS=
POOL_ID=
MONITORED_POOLS=

# Optional: for agent private key signing (Foundry test key default)
AGENT_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

---

## Fee tier schedule (PriceOracleAgent)

| Annualized volatility | Fee tier | Label |
|---|---|---|
| < 5% | 0.05% (5bps) | Ultra-low |
| 5–15% | 0.1% (10bps) | Low |
| 15–30% | 0.2% (20bps) | Moderate |
| 30–60% | 0.3% (30bps) | Standard |
| 60–100% | 0.5% (50bps) | High |
| > 100% | 1.0% (100bps) | Extreme |

---

## Performance scoring (ERC-8004 reputation)

| Action | Score | Rationale |
|---|---|---|
| MEV block | 950 | Highest value — saved LP and trader |
| Fee optimization (>20bps saved) | 900 | Significant improvement |
| Fee optimization (>10bps) | 850 | Clear improvement |
| Fee optimization (>0bps) | 800 | Marginal improvement |
| Participated, no change | 700 | Baseline for completing the job |

---

## Project structure

```
agentswap/
├── contracts/
│   ├── AgentSwapHook.sol       # Core hook: beforeSwap + afterSwap + ERC-8183 settlement
│   └── MockERC8004.sol         # Mock IdentityRegistry + ReputationRegistry + USDC for testing
├── agents/
│   ├── MEVShieldAgent.js       # Sandwich detection, signed intents, settlement tracking
│   └── PriceOracleAgent.js     # Volatility-aware dynamic fee optimization
├── scripts/
│   ├── setupArc.js             # Circle wallet creation + ERC-8004 registration
│   ├── setupCircle.js          # Wallet balance check + hook funding instructions
│   ├── deploy.js               # Hook deployment + pool configuration
│   └── simulateSandwich.js     # Hackathon demo: live sandwich attack + block
├── dashboard/
│   ├── server.js               # WebSocket + HTTP API, runs agent, streams events
│   └── index.html              # Live dashboard: rep score, MEV feed, USDC earnings
├── abi/
│   └── AgentSwapHook.json      # Hook ABI for frontend + scripts
├── test/
│   └── agentswap.test.js       # 31 tests across all agent logic
└── README.md
```

---

## Why Arc makes this possible

| Arc property | AgentSwap benefit |
|---|---|
| Sub-second finality | AgentIntent lands in the block before the victim's swap — timing is everything |
| ~$0.01 USDC gas fees | Per-swap agent micropayments ($0.001–$0.005) are viable; impossible on Ethereum mainnet |
| USDC-native | No volatile gas token; agent earnings are denominated in the same asset as LP fees |
| ERC-8004 + ERC-8183 deployed | Identity, reputation, and job settlement primitives are production-ready on Arc testnet |

