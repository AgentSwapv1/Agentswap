// // SPDX-License-Identifier: MIT
// pragma solidity ^0.8.24;

// import "forge-std/Script.sol";
// import "../contracts/MockPoolManager.sol";
// import "../contracts/AgentSwapHook.sol";
// import "../contracts/MockERC8004.sol";

// /**
//  * TestSwap.s.sol
//  *
//  * After deploying, run this to execute a live swap through the hook on Arc testnet.
//  * Shows the full beforeSwap → afterSwap → settlement data flow.
//  *
//  * Run:
//  *   forge script script/TestSwap.s.sol \
//  *     --rpc-url https://rpc.arc.testnet.circle.com \
//  *     --private-key $DEPLOYER_PRIVATE_KEY \
//  *     --broadcast \
//  *     -vvvv
//  */
// contract TestSwap is Script {

//     function run() external {
//         uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

//         address hookAddr = vm.envAddress("HOOK_ADDRESS");
//         address pmAddr   = vm.envAddress("POOL_MANAGER");
//         address usdcAddr = vm.envAddress("USDC_ADDRESS");
//         bytes32 poolId   = vm.envBytes32("POOL_ID");

//         console.log("=== TestSwap on Arc Testnet ===");
//         console.log("Hook:", hookAddr);
//         console.log("PoolManager:", pmAddr);

//         vm.startBroadcast(deployerKey);

//         MockPoolManager   pm   = MockPoolManager(pmAddr);
//         AgentSwapHook     hook = AgentSwapHook(hookAddr);

//         // Derive pool key from poolId
//         // IUniswapV4.PoolKey memory key = IUniswapV4.PoolKey({
//         //     currency0:   IUniswapV4.Currency({ token: usdcAddr }),
//         //     currency1:   IUniswapV4.Currency({ token: address(1) }),
//         //     fee:         3000,
//         //     tickSpacing: 60,
//         //     hooks:       hookAddr
//         // });

//         // Generate a unique swapId
//         bytes32 swapId = keccak256(abi.encodePacked("testswap", block.timestamp, block.number));
//         console.log("SwapId:", vm.toString(swapId));

//         // Encode swapId as hookData (this is what beforeSwap/afterSwap decode)
//         bytes memory hookData = abi.encode(swapId);

//         IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
//             zeroForOne:        true,
//             amountSpecified:   int256(100 * 1e6), // 100 USDC
//             sqrtPriceLimitX96: 0
//         });

//         console.log("Executing normal swap (no intent registered)...");
//         // (bool ok, bytes memory ret) = pmAddr.call(
//         //     abi.encodeWithSignature(
//         //         "swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes)",
//         //         key, params, hookData
//         //     )
//         // );
//         if (ok) {
//             console.log("Swap executed successfully");
//         } else {
//            // console.log("Swap reverted:", string(ret));
//         }

//         // Check swap outcome
//         AgentSwapHook.SwapOutcome memory outcome = hook.getSwapOutcome(swapId);
//         console.log("Settled:", outcome.settled);
//         console.log("MEV blocked:", outcome.mevBlocked);

//         vm.stopBroadcast();
//     }
// }
