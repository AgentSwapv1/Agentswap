// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IUniswapV4.sol";

/**
 * MockPoolManager
 *
 * Simulates Uniswap v4 PoolManager on Arc testnet (no official v4 deployment exists yet).
 * Calls beforeSwap and afterSwap on the registered hook, mimicking exactly what the
 * real PoolManager does.
 *
 * Data flow:
 *   Trader calls swap()
 *     → MockPoolManager calls hook.beforeSwap()  [hook may revert or return fee override]
 *     → MockPoolManager executes simulated swap   [USDC transfer between parties]
 *     → MockPoolManager calls hook.afterSwap()    [hook settles agent payment]
 *     → MockPoolManager emits SwapExecuted
 *
 * To upgrade to real PoolManager: deploy AgentSwapHook pointing at the real address.
 * No changes to AgentSwapHook needed — it only reads msg.sender == poolManager.
 */
contract MockPoolManager {

    address public hook;
    address public owner;

    // Simple pool state: sqrtPriceX96 per poolId
    mapping(bytes32 => uint160) public poolPrice;
    mapping(bytes32 => bool)    public poolInitialized;

    event PoolInitialized(bytes32 indexed poolId, uint160 sqrtPriceX96);
    event SwapExecuted(
        bytes32 indexed poolId,
        address indexed sender,
        bool    zeroForOne,
        int256  amountSpecified,
        uint24  feeApplied,
        bool    hookReverted,
        string  revertReason
    );

    error PoolNotInitialized(bytes32 poolId);

    constructor(address _hook) {
        hook  = _hook;
        owner = msg.sender;
    }

    function setHook(address _hook) external {
        require(msg.sender == owner, "Not owner");
        hook = _hook;
    }

    // ── Initialize a pool ─────────────────────────────────────
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick) {
        bytes32 pid = _poolId(key);
        poolPrice[pid]       = sqrtPriceX96;
        poolInitialized[pid] = true;
        emit PoolInitialized(pid, sqrtPriceX96);
        return 0; // simplified — real v4 computes tick from sqrtPriceX96
    }

    // ── Execute swap ──────────────────────────────────────────
    function swap(
        PoolKey memory key,
        IPoolManager.SwapParams memory params,
        bytes calldata hookData
    ) external returns (BalanceDelta memory delta) {
        bytes32 pid = _poolId(key);
        if (!poolInitialized[pid]) revert PoolNotInitialized(pid);

        uint24 feeOverride = 0;
        bool   hookReverted = false;
        string memory revertReason = "";

        // ── beforeSwap ───────────────────────────────────────
        if (hook != address(0)) {
            (bool ok, bytes memory ret) = hook.call(
                abi.encodeWithSelector(
                    IHooks.beforeSwap.selector,
                    msg.sender,
                    key,
                    params,
                    hookData
                )
            );

            if (!ok) {
                hookReverted = true;
                revertReason = _decodeRevertReason(ret);
                emit SwapExecuted(pid, msg.sender, params.zeroForOne, params.amountSpecified, 0, true, revertReason);
                // Propagate revert — sandwich attack blocked
                assembly { revert(add(ret, 32), mload(ret)) }
            } else if (ret.length >= 96) {
                // Decode (bytes4 selector, int256 amountDelta, uint24 lpFeeOverride)
                (, , feeOverride) = abi.decode(ret, (bytes4, int256, uint24));
            }
        }

        // ── Simulated swap execution ─────────────────────────
        uint24 effectiveFee = feeOverride > 0 ? feeOverride : key.fee;
        int256 amt = params.amountSpecified;
        delta = BalanceDelta({
            amount0: params.zeroForOne ? int128(int256(-amt)) : int128(0),
            amount1: params.zeroForOne ? int128(0)            : int128(int256(-amt))
        });

        // ── afterSwap ────────────────────────────────────────
        if (hook != address(0)) {
            (bool ok2,) = hook.call(
                abi.encodeWithSelector(
                    IHooks.afterSwap.selector,
                    msg.sender,
                    key,
                    params,
                    delta,
                    hookData
                )
            );
            // afterSwap failure is non-fatal for swap execution
            if (!ok2) revertReason = "afterSwap failed";
        }

        emit SwapExecuted(pid, msg.sender, params.zeroForOne, params.amountSpecified, effectiveFee, false, "");
        return delta;
    }

    function _poolId(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            key.currency0.token,
            key.currency1.token,
            key.fee,
            key.tickSpacing
        ));
    }

    function _decodeRevertReason(bytes memory ret) internal pure returns (string memory) {
        if (ret.length < 4) return "unknown revert";
        // Skip 4-byte selector if present
        if (ret.length > 4) {
            bytes memory data = new bytes(ret.length - 4);
            for (uint i = 4; i < ret.length; i++) data[i - 4] = ret[i];
            return string(data);
        }
        return "no reason";
    }
}
