// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal Uniswap v4 types — matches the real v4-core interfaces exactly
/// so we can swap in the real PoolManager later without changing AgentSwapHook.

struct Currency {
    address token; // address(0) = native ETH
}

struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24   fee;
    int24    tickSpacing;
    address  hooks;
}

struct BalanceDelta {
    int128 amount0;
    int128 amount1;
}

interface IPoolManager {
    struct SwapParams {
        bool    zeroForOne;
        int256  amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function swap(
        PoolKey memory key,
        SwapParams memory params,
        bytes calldata hookData
    ) external returns (BalanceDelta memory delta);

    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);
}

/// Hook permission flags — v4 hooks declare what callbacks they use
/// by encoding flags into their address. We skip address mining for testnet.
interface IHooks {
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4 selector, int256 amountDelta, uint24 lpFeeOverride);

    function afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta calldata delta,
        bytes calldata hookData
    ) external returns (bytes4 selector, int128 hookDeltaUnspecified);
}
