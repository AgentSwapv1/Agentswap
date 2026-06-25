// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev Minimal Uniswap V4 interfaces needed for AgentSwapHook
interface IPoolManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function swap(
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) external returns (int256 delta0, int256 delta1);

    function initialize(PoolKey calldata key, uint160 sqrtPriceX96) external returns (int24 tick);
}

/// @dev Base hook — AgentSwapHook inherits this
abstract contract BaseHook {
    IPoolManager public immutable poolManager;

    error NotPoolManager();
    error NotSelf();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    /// @notice Returns the permissions bitmap for this hook
    function getHookPermissions() public pure virtual returns (Hooks.Permissions memory);

    /// Hook callbacks — override in child
    function beforeSwap(
        address sender,
        IPoolManager.PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external virtual returns (bytes4, BeforeSwapDelta, uint24) {
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(
        address sender,
        IPoolManager.PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        int256 delta,
        bytes calldata hookData
    ) external virtual returns (bytes4, int128) {
        return (BaseHook.afterSwap.selector, 0);
    }
}

library Hooks {
    struct Permissions {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeAddLiquidity;
        bool afterAddLiquidity;
        bool beforeRemoveLiquidity;
        bool afterRemoveLiquidity;
        bool beforeSwap;
        bool afterSwap;
        bool beforeDonate;
        bool afterDonate;
        bool beforeSwapReturnDelta;
        bool afterSwapReturnDelta;
        bool afterAddLiquidityReturnDelta;
        bool afterRemoveL iquidityReturnDelta;
    }
}

// Needed types
type BeforeSwapDelta is int256;
library BeforeSwapDeltaLibrary {
    BeforeSwapDelta internal constant ZERO_DELTA = BeforeSwapDelta.wrap(0);
}
