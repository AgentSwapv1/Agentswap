// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {HookMiner} from "../src/HookMiner.sol";
import {StableGuardHook} from "../src/StableGuardHook.sol";

/// @notice Mines a CREATE2 salt so the deployed hook address encodes the
///         beforeSwap/afterSwap permission bits, deploys StableGuardHook,
///         then initializes a dynamic-fee pool for USDX/USDY with the hook
///         attached.

contract DeployHook is Script {
    using PoolIdLibrary for PoolKey;

    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address poolManagerAddr = vm.envAddress("POOL_MANAGER_ADDRESS");
        address usdx = vm.envAddress("MOCK_USDX_ADDRESS");
        address usdy = vm.envAddress("MOCK_USDY_ADDRESS");

        IPoolManager poolManager = IPoolManager(poolManagerAddr);

        // Hook needs BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG encoded in its address.
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);

        bytes memory constructorArgs = abi.encode(poolManager);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(StableGuardHook).creationCode, constructorArgs);

        vm.startBroadcast(pk);

        StableGuardHook hook = new StableGuardHook{salt: salt}(poolManager);
        require(address(hook) == hookAddress, "DeployHook: mined address mismatch");

        // Order currencies as required by PoolKey (currency0 < currency1).
        (Currency currency0, Currency currency1) =
            usdx < usdy ? (Currency.wrap(usdx), Currency.wrap(usdy)) : (Currency.wrap(usdy), Currency.wrap(usdx));

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, // signals dynamic fee, hook controls it
            tickSpacing: 1, // tight spacing appropriate for a stablecoin pair
            hooks: hook
        });

        // sqrtPriceX96 for a 1:1 stablecoin pair == 2^96
        uint160 sqrtPriceX96 = 79228162514264337593543950336;
        poolManager.initialize(key, sqrtPriceX96);

        vm.stopBroadcast();

        console.log("HOOK_ADDRESS=", address(hook));
        console.logBytes32(PoolId.unwrap(key.toId()));
        console.log("^ POOL_ID (bytes32, paste into api/.env as POOL_ID)");
    }
}
