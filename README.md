# AgentSwap

**AgentSwap is a reputation-gated marketplace of autonomous AgentKit-powered agents that monetize MEV protection and liquidity intelligence through USDC settlement, x402 nanopayments, and agent-to-agent commerce on Arc. 

AgentSwap monetizes agent intelligence at the transaction level. Every swap becomes a market where agents compete to provide risk analysis, MEV defense, pricing intelligence, liquidity optimization, and execution improvements. Agents earn per-action fees and build reputation over time, creating recurring revenue streams tied directly to economic value generated.**

## Live links
 
| | |
|---|---|
| **Live agent dashboard** | https://agentswap-0ovx.onrender.com |
| **Demo** | https://00245.oneapp.dev/ |
| **Hook contract (Arc testnet)** | `0x5a9BBB8f26459b9754824ca9B7B98E3D2C878817` |
| **Explorer** | https://testnet.arcscan.app/address/0x5a9BBB8f26459b9754824ca9B7B98E3D2C878817 |
 
---

## What it does

AgentSwap turns Uniswap v4 hooks into a marketplace for autonomous agents.

Every agent owns an AgentKit wallet on Arc and can:

- Monitor pools
- Submit swap intelligence
- Sell MEV protection
- Sell fee optimization recommendations
- Receive USDC payments automatically
- Pay other agents for data or execution services

Revenue is settled directly to the agent's wallet using USDC.

Agents earn more when their reputation score increases, creating a self-reinforcing market where the best performing agents receive the most swap assignments and the highest earnings.

1. Is **screened by a reputation-scored agent** (ERC-8004 gate — agents below threshold are excluded)
2. Triggers either **MEV sandwich blocking** or **dynamic fee optimization**
3. **Pays the agent** in USDC via ERC-8183 atomic settlement on Arc (sub-cent gas, sub-second finality)
4. **Updates the agent's reputation** — good performance → higher score → more pool assignments → more earnings
---

MEV costs Uniswap LPs roughly $1B+ per year. AgentSwap turns MEV defense into a paid agent service with cryptoeconomic trust as agents only stay in the market if their rep score stays above the pool's minimum threshold.
Every intent in your logs is a confirmed Arc testnet transaction. Rep scores are updating onchain via ERC-8004. The hook is live at **0x5a9BBB8f26459b9754824ca9B7B98E3D2C878817**.

## Architecture

```
## Agent Stack Integration

Each AgentSwap agent is provisioned with an AgentKit wallet.

AgentKit provides:

- Wallet creation
- USDC balances
- Onchain transaction execution
- Autonomous settlement
- Agent-to-agent payments

Example:

MEVShieldAgent
    ↓
Detects sandwich attack
    ↓
Submits signed intent
    ↓
Hook blocks attack
    ↓
USDC reward sent to AgentKit wallet
    ↓
Agent can spend earnings autonomously
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

## x402-Powered Agent Services

AgentSwap agents expose their intelligence through x402 endpoints.

Example:

POST /quote/mev-risk
POST /quote/optimal-fee

External agents can purchase:

- MEV risk scores
- Pool volatility forecasts
- Fee optimization recommendations
- Historical reputation analytics

using USDC nanopayments.

Flow:

Consumer Agent
    ↓
x402 payment request
    ↓
USDC nanopayment
    ↓
MEVShieldAgent API
    ↓
Risk assessment returned

This creates recurring revenue beyond swap rewards.

## ERC-8004 + x402 integration

| Standard | Role in AgentSwap |
|---|---|
| ERC-8004 IdentityRegistry | Agent registers capabilities: `["mev_detection", "fee_optimization"]` |
| ERC-8004 ReputationRegistry | Hook gates swap access by `getScore(agentId) ≥ minRepScore`. Score updated `afterSwap` |
| ERC-8183 AgenticCommerce | Atomic job creation + escrow + completion in `afterSwap`. Hook is evaluator (deterministic outcome) |

Trader submits swap
  ↓
PoolManager.swap()
  ↓
AgentSwapHook.beforeSwap()

  ├─ Reputation check
  ├─ Read agent intent
  ├─ MEV detection
  └─ Fee optimization

  ↓

Swap executes

  ↓

AgentSwapHook.afterSwap()

  ├─ Performance evaluation
  ├─ ERC-8183 settlement
  ├─ USDC payout → AgentKit wallet
  └─ Reputation update

  ↓

Agent exposes x402 endpoint

  ├─ Sell MEV intelligence
  ├─ Sell fee forecasts
  └─ Earn additional USDC nanopayments

## How Agents Make Money

AgentSwap agents have three revenue streams:

### 1. Swap Rewards

The hook pays agents whenever:

- A sandwich attack is blocked
- A fee optimization is accepted

Settlement occurs automatically in USDC.

### 2. x402 API Sales

Agents sell intelligence to other agents:

- MEV predictions
- Volatility forecasts
- Fee recommendations

Each request is paid using USDC nanopayments.

### 3. Reputation Premiums

Higher ERC-8004 reputation leads to:

- More pool assignments
- More swap opportunities
- More x402 customers

Reputation becomes an onchain business asset.

Arc testnet contracts:
```
IdentityRegistry:   0x8004A818BFB912233c491871b3d84c89A494BD9e
ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
ValidationRegistry: 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
AgenticCommerce:    0x0747EEf0706327138c69792bF28Cd525089e4583
Mock-USDC_ADDRESS:  0xE4b73bA327A6A332cA3dCD6Ebd1c0A095eBBE37D
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
$ forge script script/Deploy.s.sol   --rpc-url https://rpc.testnet.arc.network   --private-key $DEPLOYER_PRIVATE_KEY   --broadcast   -vvv
```
```

### 6. Run the demo
```bash

# Or start the agents
npm run agent:mev      # MEVShieldAgent (terminal 1)
npm run agent:oracle   # PriceOracleAgent (terminal 2)
npm run dashboard      # Live dashboard 
```

### 7. Run tests
```bash
npm test
```

---

## Environment variables

```bash
# Circle credentials (required)
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=

# Arc testnet
ARC_RPC_URL=https://rpc.testnet.arc.network

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
AGENT_PRIVATE_KEY=
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
│   └── simulateSandwich.js     # live sandwich attack + block
├── dashboard/
│   ├── server.js               # WebSocket + HTTP API, runs agent, streams events
│   └── index.html              # Live dashboard: rep score, MEV feed, USDC earnings
├── abi/
│   └── AgentSwapHook.json   
├── test/
│   └── agentswap.test.js      
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

