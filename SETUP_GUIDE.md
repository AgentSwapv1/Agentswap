# AgentSwap — Complete Setup Guide
**From zero to running AI agent, step by step.**

> This guide assumes you have never built an AI agent before.
> Every command is copy-pasteable. Each step explains *why* you're doing it.

---

## What you'll have running at the end

| What | Where |
|---|---|
| Live MEV shield agent | Terminal 1 — monitoring for sandwich attacks |
| Live price oracle agent | Terminal 2 — optimizing swap fees |
| Live dashboard | http://localhost:3000 — real-time feed |
| Demo simulation | Terminal 3 — sandwich attack blocked live |

Total time: ~30 minutes

---

## Part 1 — Install tools on your computer

You need three things: Node.js (runs JavaScript), Python/uv (runs Arc CLI), and the project files.

---

### Step 1.1 — Install Node.js

Node.js is the runtime that executes the agent code.

**Check if you already have it:**
```bash
node --version
```
If you see `v20.x.x` or higher, skip to Step 1.2.

**Install Node.js (pick your OS):**

**macOS:**
```bash
# Install Homebrew first if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then install Node.js
brew install node
```

**Ubuntu / Linux:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows:**
Download and run the installer from https://nodejs.org (choose "LTS" version)

**Verify it worked:**
```bash
node --version   # should print v20.x.x or higher
npm --version    # should print 10.x.x or higher
```

---

### Step 1.2 — Install Python + uv (for Arc CLI)

uv is a fast Python package manager used to install the Arc CLI.

**macOS / Linux:**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh

# Restart your terminal, then verify:
uv --version
```

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

---

### Step 1.3 — Install the Arc CLI

The Arc CLI gives you access to Arc testnet — the blockchain where your agents settle payments.

```bash
uv tool install git+https://github.com/the-canteen-dev/ARC-cli
```

**Verify:**
```bash
arc --version
```

---

### Step 1.4 — Install the Circle CLI

Circle CLI manages the wallets your agents use to send and receive USDC.

```bash
npm install -g @circle-fin/cli
```

**Verify:**
```bash
circle --version
```

---

## Part 2 — Get the project files

### Step 2.1 — Unzip the project

Download `agentswap.zip` and unzip it somewhere you can find it easily.

**macOS / Linux:**
```bash
# Replace ~/Downloads with wherever you saved the zip
cd ~/Downloads
unzip agentswap.zip
cd agentswap
```

**Windows:**
Right-click `agentswap.zip` → Extract All → open the `agentswap` folder in File Explorer, then open Terminal in that folder (right-click → "Open in Terminal")

**You should see these files:**
```
agentswap/
├── contracts/          ← Solidity smart contracts
├── agents/             ← AI agent processes
├── scripts/            ← Setup and deploy scripts
├── dashboard/          ← Live web dashboard
├── abi/                ← Contract interface definitions
├── test/               ← Test suite
├── package.json        ← Project config
├── .env.example        ← Template for your secrets
└── README.md
```

---

### Step 2.2 — Install JavaScript dependencies

This downloads all the libraries the agents need (viem, Circle SDK, etc.).

```bash
# Make sure you're inside the agentswap folder
cd agentswap

npm install
```

This takes 1-2 minutes. You'll see a lot of text — that's normal.

**Verify:**
```bash
npm test
```
You should see:
```
  Passed: 31
  Failed: 0
  ✓ All tests passed
```

If tests pass, your local setup is working correctly.

---

## Part 3 — Create your Circle account and API key

Circle is the company behind USDC. Your agents use Circle's infrastructure to create wallets and settle payments on Arc.

### Step 3.1 — Create a Circle Developer account

1. Go to https://console.circle.com
2. Click **Sign Up**
3. Verify your email
4. You're in the Console

### Step 3.2 — Create an API key

1. In the Console, click **Keys** in the left sidebar
2. Click **Create a key**
3. Choose **API key** → **Standard Key**
4. Give it a name: `agentswap-hackathon`
5. Click **Create**
6. **Copy the key immediately** — it's only shown once
7. Save it somewhere safe (you'll need it in the next step)

### Step 3.3 — Register your Entity Secret

The Entity Secret is a second credential that authorizes wallet operations. Circle requires both.

```bash
# Generate it using the Circle CLI
circle generate-entity-secret
```

This prints a long string. Copy it.

Then register it:
```bash
circle register-entity-secret --entity-secret YOUR_SECRET_HERE
```

You'll be prompted for your API key. Paste it in.

---

## Part 4 — Configure your environment file

### Step 4.1 — Create your .env file

The `.env` file stores your secrets locally. It is **never committed to git**.

```bash
# Inside the agentswap folder
cp .env.example .env
```

### Step 4.2 — Edit the .env file

Open `.env` in any text editor (VS Code, Notepad, nano, etc.):

```bash
# macOS / Linux
nano .env

# Or open with VS Code
code .env
```

Find these two lines and fill them in:
```
CIRCLE_API_KEY=paste_your_api_key_here
CIRCLE_ENTITY_SECRET=paste_your_entity_secret_here
```

Leave everything else as-is for now. Save the file.

**Your .env should look like:**
```bash
CIRCLE_API_KEY=TEST_API_KEY:abc123xyz...
CIRCLE_ENTITY_SECRET=a1b2c3d4e5f6...

ARC_RPC_URL=https://rpc.arc.testnet.circle.com
CHAIN_ID=1516

# These will be filled by setup scripts:
WALLET_SET_ID=
DEPLOYER_WALLET_ID=
DEPLOYER_ADDRESS=
AGENT_WALLET_ID=
AGENT_ADDRESS=
AGENT_ID=
...
```

---

## Part 5 — Set up Arc testnet wallets

Your agents need wallets on Arc testnet to send and receive USDC. This script creates them automatically.

### Step 5.1 — Run the Arc setup script

```bash
npm run setup:arc
```

This does three things:
1. Creates a "wallet set" (a group of wallets) in your Circle account
2. Creates two wallets: one for deploying contracts, one for the agent
3. Writes all the wallet addresses and IDs to your `.env` file

**You'll see output like:**
```
[setup-arc] Creating AgentSwap wallet set...
[setup-arc] Wallet set created: abc-123-xyz
[setup-arc] Creating 2 Arc Testnet SCA wallets...
[setup-arc] Deployer wallet: 0xDe1...
[setup-arc] Agent wallet:    0xAg3...
[setup-arc] .env updated ✓
```

### Step 5.2 — Fund your wallets with testnet USDC

Your wallets need USDC to pay for gas and agent fees. Testnet USDC is free.

1. Go to https://faucet.arc.testnet.circle.com
2. Paste your **Deployer wallet address** (printed in the setup output)
3. Request USDC — you'll get 10 USDC
4. Repeat with your **Agent wallet address**

**How to find your wallet addresses:**
```bash
# They're now in your .env file
grep "ADDRESS" .env
```

**Wait ~30 seconds**, then verify the funds arrived:
```bash
npm run setup:circle
```

You'll see the USDC balance for each wallet.

---

## Part 6 — Deploy the hook contract

The hook is the Solidity smart contract that lives on Arc and intercepts every swap. You deploy it once.

### Step 6.1 — Deploy

```bash
npm run deploy
```

This:
1. Prints all the constructor arguments for `AgentSwapHook.sol`
2. Registers your agent on ERC-8004 `IdentityRegistry`
3. Writes the hook address and pool ID to your `.env`
4. Shows the full deployment summary

**You'll see:**
```
─── AgentSwap Deployment ─────────────
Network:  Arc Testnet (chain 1516)
Deployer: 0xDe1...
Agent:    0xAg3...

1. Registering MEVShieldAgent on ERC-8004...
   ✓ registerAgent tx: 0xabc...
2. MockUSDC: 0xFbD...
3. Hook constructor args: { poolManager: ..., identityRegistry: ..., ... }
   ✓ Hook: 0xhook... (set HOOK_ADDRESS after deployment)

─── Deployment Summary ─────────────
  Agent ID:      0x6d65...
  Hook Address:  0xhook...
  Pool ID:       0xpool...
```

> **Note:** For the full hackathon submission you'd paste these constructor args into the Arc deployer UI or use Foundry (`forge create`). For the demo, the scripts work without an actual deployed hook — the agents run in simulation mode and all events still fire.

---

## Part 7 — Run the agents

You need **three terminal windows** open at the same time. Open them now.

---

### Terminal 1 — MEV Shield Agent

```bash
cd agentswap
npm run agent:mev
```

**What you'll see:**
```
[MEVShield 12:00:01.000] Starting MEVShieldAgent...
[MEVShield 12:00:01.001] [rep] Bootstrap score: 800
[MEVShield 12:00:01.002] Mempool monitor active (simulation mode)
[MEVShield 12:00:01.003] Active | wallet: 0xAg3...
[MEVShield 12:00:04.000] [mempool] USDC->ETH | 42350 USDC | 0xabcdef...
[MEVShield 12:00:07.000] [mempool] ETH->USDC | 8200 USDC | 0x123456...
[MEVShield 12:00:10.000] [MEV] known_mev_bot_address | confidence: 95%
[MEVShield 12:00:10.100] [intent] mev:true fee:0bps | 0xdead000000...
[MEVShield 12:00:11.300] [settled] +$0.0050 USDC | perf: 950 | rep: 875
```

The agent is now live — scanning every simulated pending swap, detecting MEV, and earning USDC per successful block.

---

### Terminal 2 — Price Oracle Agent

```bash
cd agentswap
npm run agent:oracle
```

**What you'll see:**
```
[OracleAgent 12:00:01] Starting PriceOracleAgent...
[OracleAgent 12:00:03] [price] $2987.43 | vol: 18.42% | regime: moderate | fee: 2000bps
[OracleAgent 12:00:03] [intent] fee: 2000bps | regime: moderate | 0x3a7f...
[OracleAgent 12:00:04] [settled] +$0.0010 | perf: 860 | rep: 830
```

This agent watches the USDC/ETH price feed and continuously suggests optimal fee tiers based on volatility.

---

### Terminal 3 — Live Dashboard

```bash
cd agentswap
npm run dashboard
```

Then open your browser and go to: **http://localhost:3000**

You'll see:
- **Rep score** — live ERC-8004 reputation meter, updates with every job
- **USDC earned** — total earnings via ERC-8183 settlement
- **Live event feed** — every swap analyzed, every MEV block, every settlement
- **Reputation history bars** — visual rep score trend

---

## Part 8 — Run the demo (hackathon showstopper)

This is the script you run during your demo video or live judging.

```bash
# Open a 4th terminal (or stop the agents temporarily)
cd agentswap
npm run demo
```

You'll see a fully narrated, colour-coded simulation:

```
── AgentSwap — Live Sandwich Demo ──────────────────

[1] Agent starts monitoring USDC/ETH pool...
[mempool] USDC->ETH | $5,000 USDC | 0xalice...
[mempool] ETH->USDC | $3,200 USDC | 0xbob...

── Phase 2: Sandwich attack begins ─────────────────

  FRONT-RUN DETECTED:
  From:      0xdead...0001  (known MEV bot)
  Amount:    $95,000 USDC
  Gas price: 80 gwei  (5.3x avg)

  VICTIM TX:
  Expected loss without protection: ~$216 USDC (1.8% slippage)

── Phase 3: MEVShieldAgent intervenes ──────────────

  Pattern:    known_mev_bot_address
  Confidence: 95%
  → Submitting signed AgentIntent (mevFlag: true)...

── Phase 4: Hook blocks the attack ─────────────────

  REVERT: MEVDetected("Known MEV bot: 0xdead...0001")
  Sandwich tx:  REVERTED
  Victim tx:    PROTECTED — proceeds at fair price
  Slippage saved: ~$216 USDC

── Phase 5: USDC settlement + reputation update ────

  USDC paid:   $0.005
  Settled in:  <1s (Arc sub-second finality)
  New rep:     950/1000 ↑
```

---

## Troubleshooting

### "Cannot find module" error
```bash
# You're not in the right folder, or npm install wasn't run
cd agentswap
npm install
```

### "CIRCLE_API_KEY not set" error
```bash
# Check your .env file exists and has the key
cat .env | grep CIRCLE_API_KEY
# Should print: CIRCLE_API_KEY=TEST_API_KEY:...
```

### "Set AGENT_PRIVATE_KEY" error
The agents need a private key for signing intents. The `.env.example` includes a safe test key for local development. Make sure it's in your `.env`:
```bash
grep AGENT_PRIVATE_KEY .env
# Should print the key. If not, copy it from .env.example
```

### Dashboard shows "Disconnected"
The WebSocket sometimes needs a second. Refresh the page. If it still fails, the dashboard falls back to polling the `/api/status` endpoint every 3 seconds automatically.

### Tests failing
```bash
# Run tests to see exactly what's wrong
npm test

# Most common issue: wrong Node.js version
node --version  # needs v20+
```

### "Transaction failed" on deploy
Your wallets need USDC. Fund them at https://faucet.arc.testnet.circle.com and wait 30 seconds.

---

## What each file does (quick reference)

| File | What it does |
|---|---|
| `contracts/AgentSwapHook.sol` | The on-chain hook — lives on Arc, intercepts swaps |
| `contracts/MockERC8004.sol` | Test versions of ERC-8004 contracts |
| `agents/MEVShieldAgent.js` | Detects sandwich attacks, submits blocking intents |
| `agents/PriceOracleAgent.js` | Tracks volatility, suggests optimal swap fees |
| `scripts/setupArc.js` | Creates your Arc wallets via Circle SDK |
| `scripts/setupCircle.js` | Checks USDC balances, prints funding instructions |
| `scripts/deploy.js` | Deploys AgentSwapHook to Arc testnet |
| `scripts/simulateSandwich.js` | Hackathon demo — sandwich attack blocked live |
| `dashboard/server.js` | WebSocket server + HTTP API |
| `dashboard/index.html` | Live dashboard frontend |
| `test/agentswap.test.js` | 31 tests for all agent logic |
| `.env.example` | Template — copy to .env and fill in secrets |

---

## npm script reference

| Command | What it does |
|---|---|
| `npm run setup:arc` | Create Arc wallets, write to .env |
| `npm run setup:circle` | Check wallet balances |
| `npm run deploy` | Deploy hook contract to Arc testnet |
| `npm run agent:mev` | Start MEV Shield Agent |
| `npm run agent:oracle` | Start Price Oracle Agent |
| `npm run dashboard` | Start dashboard at localhost:3000 |
| `npm run demo` | Run sandwich attack demo |
| `npm test` | Run all 31 tests |

---

## Key concepts (plain English)

**ERC-8004** — A standard on Arc for giving AI agents an identity and reputation score. Like a LinkedIn profile for your agent, stored on the blockchain.

**ERC-8183** — A standard for creating a job, locking payment in escrow, and releasing it when the job is done. Like Upwork, but fully automated and settled in USDC.

**Uniswap v4 hook** — A piece of code that runs automatically before and after every swap on a Uniswap pool. AgentSwapHook plugs AI agents into this lifecycle.

**AgentIntent** — A signed message the agent submits before a swap happens. Like raising your hand before a question — the hook reads it when the swap arrives.

**Arc testnet** — A test version of Arc blockchain where everything is free. Use it to build and demo. Tokens have no real value.

**USDC (testnet)** — Free test dollars. Used to simulate real agent payments during development.

---

*AgentSwap — Built for Lepton Agents Hackathon 2025 | @CoderOfPHCity / Cliphaus Labs*
