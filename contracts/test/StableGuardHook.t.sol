// // SPDX-License-Identifier: MIT
// pragma solidity ^0.8.26;

// import {Test, console} from "forge-std/Test.sol";
// import {Deployers} from "v4-periphery/../test/utils/Deployers.sol";
// import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
// import {PoolKey} from "v4-core/types/PoolKey.sol";
// import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
// import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
// import {Hooks} from "v4-core/libraries/Hooks.sol";
// import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
// import {HookMiner} from "v4-periphery/utils/HookMiner.sol";
// import {StableGuardHook} from "../src/StableGuardHook.sol";
// import {MockUSD} from "../src/mocks/MockUSD.sol";

// /// @dev This test relies on Uniswap's Deployers test helper (bundled in
// ///      v4-periphery's test utils) to spin up a local PoolManager + routers.
// ///      If your installed v4-periphery version keeps Deployers at a
// ///      different path, adjust the import above — this is one of the more
// ///      frequently-moved files across v4 releases.
// contract StableGuardHookTest is Test, Deployers {
//     using PoolIdLibrary for PoolKey;

//     StableGuardHook hook;
//     MockUSD usdx;
//     MockUSD usdy;
//     PoolKey poolKey;

//     function setUp() public {
//         deployFreshManagerAndRouters();

//         usdx = new MockUSD("USD X", "USDX");
//         usdy = new MockUSD("USD Y", "USDY");

//         uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
//         (address hookAddress, bytes32 salt) = HookMiner.find(
//             address(this), flags, type(StableGuardHook).creationCode, abi.encode(manager)
//         );
//         hook = new StableGuardHook{salt: salt}(manager);
//         require(address(hook) == hookAddress, "hook address mismatch");

//         (Currency c0, Currency c1) = address(usdx) < address(usdy)
//             ? (Currency.wrap(address(usdx)), Currency.wrap(address(usdy)))
//             : (Currency.wrap(address(usdy)), Currency.wrap(address(usdx)));

//         poolKey = PoolKey({
//             currency0: c0,
//             currency1: c1,
//             fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
//             tickSpacing: 1,
//             hooks: hook
//         });

//         manager.initialize(poolKey, 79228162514264337593543950336);
//     }

//     function test_calmTierIsDefaultFee() public {
//         (,, uint24 fee,,) = hook.getProtectionStatus(poolKey.toId());
//         assertEq(fee, hook.feeCalm());
//     }

//     function test_circuitBreakerTripsOnOversizedSwap() public {
//         // A swap far larger than hardCapThreshold should revert with
//         // CircuitBreakerActive rather than silently draining the pool.
//         int256 hugeAmount = hook.hardCapThreshold() * 2;

//         vm.expectRevert();
//         // NOTE: wire this to your local swap router of choice (Deployers
//         // exposes `swapRouter` in most v4-periphery versions). Left as a
//         // scaffold — fill in with the exact SwapParams your installed
//         // version expects once `forge test` surfaces the exact interface.
//         // swapRouter.swap(poolKey, SwapParams({...}), ...);
//     }

//     function test_setThresholds_onlyOwner() public {
//         vm.prank(address(0xBEEF));
//         vm.expectRevert();
//         hook.setThresholds(1e16, 2e16, 3e16);

//         hook.setThresholds(1e16, 2e16, 3e16);
//         assertEq(hook.elevatedThreshold(), 1e16);
//     }
// }
