// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/AgentSwapHook.sol";

/**
 * RegisterIntent.s.sol
 *
 * Simulates the agent submitting a signed MEV intent onchain.
 * Run this BEFORE TestSwap to see the sandwich block in action.
 *
 * In production this is called by MEVShieldAgent.js automatically.
 * This script lets you test the full flow manually from the CLI.
 *
 * Run:
 *   forge script script/RegisterIntent.s.sol \
 *     --rpc-url https://rpc.arc.testnet.circle.com \
 *     --private-key $AGENT_PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 */
contract RegisterIntent is Script {

    function run() external {
        uint256 agentKey  = vm.envUint("AGENT_PRIVATE_KEY");
        address hookAddr  = vm.envAddress("HOOK_ADDRESS");
        address agentAddr = vm.addr(agentKey);

        // Use same swapId as TestSwap (or set one explicitly)
        bytes32 swapId    = vm.envOr("TEST_SWAP_ID",
            bytes32(keccak256(abi.encodePacked("testswap", block.timestamp, block.number)))
        );

        uint24  feeOverride = 2000;  // suggest 0.2% instead of 0.3%
        bool    mevFlag     = false; // set true to simulate MEV block
        string memory evidence = "";
        uint256 ts          = block.timestamp;

        // Sign the intent
        bytes32 intentHash = keccak256(abi.encodePacked(swapId, feeOverride, mevFlag, ts));
        bytes32 ethHash    = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", intentHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        console.log("=== RegisterIntent on Arc Testnet ===");
        console.log("Agent:", agentAddr);
        console.log("SwapId:", vm.toString(swapId));
        console.log("FeeOverride:", feeOverride, "bps");
        console.log("MEV flag:", mevFlag);

        vm.startBroadcast(agentKey);
        AgentSwapHook(hookAddr).registerIntent(
            swapId, feeOverride, mevFlag, evidence, ts, sig
        );
        vm.stopBroadcast();

        console.log("Intent registered. Now run TestSwap to execute the swap.");

        // Verify it's stored
        AgentSwapHook.AgentIntent memory intent = AgentSwapHook(hookAddr).getPendingIntent(swapId);
        console.log("Intent stored:", intent.exists);
        console.log("Fee override:", intent.feeOverrideBps);
    }
}
