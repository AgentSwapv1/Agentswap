import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createPublicClient, http, parseAbiItem, getContract } from "viem";
import { arcTestnet } from "viem/chains";
import dotenv from "dotenv";
dotenv.config();

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const METADATA_URI = "ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei";

async function waitForTransaction(circleClient, txId, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await circleClient.getTransaction({ id: txId });
    if (data?.transaction?.state === "COMPLETE") {
      const txHash = data.transaction.txHash;
      console.log(` ✓\n  Tx: https://testnet.arcscan.app/tx/${txHash}`);
      return txHash;
    }
    if (data?.transaction?.state === "FAILED") {
      throw new Error(`${label} failed onchain`);
    }
    process.stdout.write(".");
  }
  throw new Error(`${label} timed out`);
}

async function main() {
  console.log("\n── Registering Agent on Arc ERC-8004 ──");

  const circleClient = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
  });

  // Check if we have existing wallet IDs in .env to reuse
  const existingOwnerId = process.env.OWNER_WALLET_ID;
  const existingValidatorId = process.env.VALIDATOR_WALLET_ID;

  let ownerWallet, validatorWallet;

  if (existingOwnerId && existingValidatorId) {
    console.log(`  Using existing wallets: ${existingOwnerId}, ${existingValidatorId}`);
    // If you have the wallet addresses, you could fetch them, but for simplicity we'll create new ones.
    // The SDK doesn't have a direct "get wallet by ID" method that returns address easily.
    // We'll create new ones; they are free on testnet.
    console.log("  Creating new wallets instead (to avoid fetching)");
  }

  // Create wallet set and wallets (idempotent, can recreate)
  const walletSet = await circleClient.createWalletSet({
    name: "AgentSwap Agent Wallets",
  });

  const walletsResponse = await circleClient.createWallets({
    blockchains: ["ARC-TESTNET"],
    count: 2,
    walletSetId: walletSet.data?.walletSet?.id ?? "",
    accountType: "SCA",
  });

  ownerWallet = walletsResponse.data?.wallets?.[0];
  validatorWallet = walletsResponse.data?.wallets?.[1];

  console.log(`  Owner wallet:     ${ownerWallet.address} (${ownerWallet.id})`);
  console.log(`  Validator wallet: ${validatorWallet.address} (${validatorWallet.id})`);

  console.log(`\n  Add to .env:`);
  console.log(`  OWNER_WALLET_ID=${ownerWallet.id}`);
  console.log(`  VALIDATOR_WALLET_ID=${validatorWallet.id}`);
  console.log(`  AGENT_WALLET_ADDRESS=${ownerWallet.address}`);

  // Register agent
  console.log(`\n── Registering agent with metadata: ${METADATA_URI} ──`);

  const registerTx = await circleClient.createContractExecutionTransaction({
    walletAddress: ownerWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: IDENTITY_REGISTRY,
    abiFunctionSignature: "register(string)",
    abiParameters: [METADATA_URI],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  await waitForTransaction(circleClient, registerTx.data?.id, "registration");

  // Get agent ID from Transfer event
  console.log("\n── Retrieving Agent ID ──");

  const latestBlock = await publicClient.getBlockNumber();
  const blockRange = 10000n;
  const fromBlock = latestBlock > blockRange ? latestBlock - blockRange : 0n;

  const transferLogs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
    ),
    args: { to: ownerWallet.address },
    fromBlock,
    toBlock: latestBlock,
  });

  if (transferLogs.length === 0) {
    throw new Error("No Transfer events found — registration may have failed");
  }

  const agentId = transferLogs[transferLogs.length - 1].args.tokenId.toString();

  console.log(`  Agent ID (uint256): ${agentId}`);
  const agentIdBytes32 = "0x" + BigInt(agentId).toString(16).padStart(64, "0");
  console.log(`  Agent ID (bytes32): ${agentIdBytes32}`);

  console.log(`\n  Add to .env:`);
  console.log(`  AGENT_ID_RAW=${agentId}`);
  console.log(`  AGENT_ID=${agentIdBytes32}`);
  console.log(`  AGENT_WALLET=${ownerWallet.address}`);

  // Verify owner
  const identityContract = getContract({
    address: IDENTITY_REGISTRY,
    abi: [
      {
        name: "ownerOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [{ name: "", type: "address" }],
      },
    ],
    client: publicClient,
  });

  const owner = await identityContract.read.ownerOf([BigInt(agentId)]);
  console.log(`  Verified owner: ${owner}`);

  console.log("\n✅ Agent registered successfully!");
}

main().catch(console.error);