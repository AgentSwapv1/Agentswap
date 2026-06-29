// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/MockERC8004.sol";
import "../contracts/MockPoolManager.sol";
import "../contracts/AgentSwapHook.sol";

contract DeployAgentSwap is Script {
    // Arc testnet real USDC — we'll use mock for simplicity
    address constant ARC_USDC = 0xFbDa5F676cB37624f28265A144A48B0d6e87d3b6;

    // Arc testnet real ERC-8004 contracts (we'll use these)
    address constant ARC_IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant ARC_REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address constant AGENTIC_COMMERCE = 0x0747EEf0706327138c69792bF28Cd525089e4583;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Read agent ID and wallet from env (required)
        bytes32 agentId = vm.envBytes32("AGENT_ID");
        address agentWallet = vm.envAddress("AGENT_WALLET");

        console.log("=== AgentSwap Deployment to Arc Testnet ===");
        console.log("Deployer:    ", deployer);
        console.log("Agent wallet:", agentWallet);
        console.log("Agent ID:    ", vm.toString(agentId));

        vm.startBroadcast(deployerKey);

        // ── Step 1: USDC (use mock) ─────────────────────────
        MockUSDC mockUSDC = new MockUSDC();
        address usdcAddr = address(mockUSDC);
        console.log("Deployed MockUSDC:", usdcAddr);

        // ── Step 2: Use real ERC-8004 ────────────────────────
        address identityAddr = ARC_IDENTITY_REGISTRY;
        address repAddr = ARC_REPUTATION_REGISTRY;
        address agentcommerce = AGENTIC_COMMERCE;
        console.log("Using Arc ERC-8004 IdentityRegistry:", identityAddr);
        console.log("Using Arc ERC-8004 ReputationRegistry:", repAddr);

        // ── Step 3: Deploy Hook (first with zero poolManager) ──
        AgentSwapHook hook = new AgentSwapHook(address(0), identityAddr, repAddr, usdcAddr, agentcommerce);
        console.log("Deployed AgentSwapHook (temp):", address(hook));

        // ── Step 4: Deploy MockPoolManager ──────────────────
        MockPoolManager pm = new MockPoolManager(address(hook));
        console.log("Deployed MockPoolManager:", address(pm));

        // ── Step 5: Redeploy Hook with correct poolManager ──
        hook = new AgentSwapHook(address(pm), identityAddr, repAddr, usdcAddr, agentcommerce);
        pm.setHook(address(hook));
        console.log("Redeployed AgentSwapHook (final):", address(hook));

        // ── Step 6: Configure pool on hook ──────────────────
        bytes32 poolId = keccak256(
            abi.encode(
                usdcAddr,
                address(1), // WETH placeholder
                uint24(3000),
                int24(60)
            )
        );

        hook.configurePool(
            poolId,
            agentId, // from .env
            agentWallet, // from .env
            750, // minRepScore
            5, // agentFeeBps
            true, // mevProtection
            true // dynamicFee
        );
        console.log("Pool configured. Pool ID:", vm.toString(poolId));

        // ── Step 7: Seed hook with USDC ─────────────────────
        mockUSDC.mint(address(hook), 1000 * 1e6); // 1000 USDC
        console.log("Seeded hook with 1000 MockUSDC");

        vm.stopBroadcast();

        // ── Print deployment summary ──────────────────────────
        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("Copy these to your .env:\n");
        console.log(string(abi.encodePacked("HOOK_ADDRESS=", vm.toString(address(hook)))));
        console.log(string(abi.encodePacked("POOL_MANAGER=", vm.toString(address(pm)))));
        console.log(string(abi.encodePacked("USDC_ADDRESS=", vm.toString(usdcAddr))));
        console.log(string(abi.encodePacked("IDENTITY_REGISTRY=", vm.toString(identityAddr))));
        console.log(string(abi.encodePacked("REP_REGISTRY=", vm.toString(repAddr))));
        console.log(string(abi.encodePacked("POOL_ID=", vm.toString(poolId))));
        console.log(string(abi.encodePacked("MONITORED_POOLS=", vm.toString(poolId))));
        console.log(string(abi.encodePacked("AGENT_ID=", vm.toString(agentId))));
    }
}
