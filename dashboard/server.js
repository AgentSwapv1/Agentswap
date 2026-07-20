/**
 * dashboard/server.js
 * WebSocket + HTTP API server for AgentSwap dashboard.
 * Runs the MEVShieldAgent and streams events to the frontend.
 *
 * Run: node dashboard/server.js
 */

import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { MEVShieldAgent } from '../agents/MEVShieldAgent.js'
import { keccak256, toBytes } from 'viem'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.deployed' })

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000

const POOL_ID = process.env.POOL_ID || keccak256(toBytes('USDC/WETH-demo-pool'))
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY ||
  ''

// ── Init agent ─────────────────────────────────
const agent = new MEVShieldAgent({
  agentId:        process.env.AGENT_ID || '0x6d65767368' + '0'.repeat(58),
  agentPrivateKey: AGENT_KEY,
  hookAddress:    process.env.HOOK_ADDRESS || '0x' + '1'.padStart(40, '0'),
  monitoredPools: [POOL_ID],
})

// ── In-memory event log (last 100) ─────────────
const eventLog = []
function pushEvent(event) {
  eventLog.push({ ...event, ts: Date.now() })
  if (eventLog.length > 100) eventLog.shift()
}

agent.on('intentSubmitted', (data) => {
  pushEvent({ type: 'intent', ...data })
})
agent.on('settled', (data) => {
  pushEvent({ type: 'settled', ...data })
})

// ── HTTP server ─────────────────────────────────
const server = createServer((req, res) => {
  const url = req.url.split('?')[0]

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(readFileSync(join(__dirname, 'index.html'), 'utf-8'))
    return
  }

  if (url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(agent.getStatus()))
    return
  }

  if (url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(eventLog.slice(-20).reverse()))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

// ── WebSocket server ────────────────────────────
const wss = new WebSocketServer({ server })

function broadcast(msg) {
  const data = JSON.stringify(msg)
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(data) })
}

// Forward agent events to all connected browsers
agent.on('intentSubmitted', (data) => broadcast({ type: 'intent', ...data, ts: Date.now() }))
agent.on('settled', (data)          => broadcast({ type: 'settled', ...data, ts: Date.now() }))

// Push status update every 2s
setInterval(() => {
  broadcast({ type: 'status', ...agent.getStatus(), ts: Date.now() })
}, 2000)

wss.on('connection', (ws) => {
  // Send current state immediately on connect
  ws.send(JSON.stringify({ type: 'status', ...agent.getStatus(), ts: Date.now() }))
  ws.send(JSON.stringify({ type: 'history', events: eventLog.slice(-20).reverse() }))
})

// ── Start ───────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`\nAgentSwap Dashboard`)
  console.log(`Dashboard: http://localhost:${PORT}`)
  console.log(`API:       http://localhost:${PORT}/api/status`)
  console.log(`WS:        ws://localhost:${PORT}\n`)
  await agent.start()
})
