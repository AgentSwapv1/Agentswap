// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {CurrencySettler} from "uniswap-hooks/utils/CurrencySettler.sol";
/// @title StableGuardRouter
/// @notice Minimal router that lets an agent swap into a StableGuard pool
///         using a Permit2 signature instead of a separate on-chain
///         approve() transaction — same gasless-approval pattern the Trade
///         API's Permit2 flow uses, adapted for a direct pool swap rather
///         than routed execution.

contract StableGuardRouter is IUnlockCallback {
    using CurrencySettler for Currency;
    using CurrencySettler for Currency;

    IPoolManager public immutable poolManager;
    ISignatureTransfer public immutable permit2;

    struct SwapCallbackData {
        address payer;
        PoolKey key;
        SwapParams params;
    }

    error NotPoolManager();

    constructor(IPoolManager _poolManager, ISignatureTransfer _permit2) {
        poolManager = _poolManager;
        permit2 = _permit2;
    }

    /// @notice Swap into a StableGuard pool, pulling the input token via a
    ///         Permit2 signature instead of a prior approve() call.
    /// @param permit The Permit2 SignatureTransfer permit the agent signed
    ///        off-chain (see api/src/permit2 for the typed-data the agent
    ///        needs to sign to produce `signature`).
    function swapWithPermit2(
        PoolKey calldata key,
        SwapParams calldata params,
        ISignatureTransfer.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external returns (BalanceDelta delta) {
        // Pulls tokens straight to this router using the agent's signature —
        // no separate on-chain approve() transaction required.
        permit2.permitTransferFrom(
            permit,
            ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: permit.permitted.amount}),
            msg.sender,
            signature
        );

        bytes memory result =
            poolManager.unlock(abi.encode(SwapCallbackData({payer: msg.sender, key: key, params: params})));
        delta = abi.decode(result, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        SwapCallbackData memory cbData = abi.decode(data, (SwapCallbackData));
        BalanceDelta delta = poolManager.swap(cbData.key, cbData.params, "");
        _settleDelta(cbData.key, delta, cbData.payer);

        return abi.encode(delta);
    }

    /// @dev Simplified settlement: negative delta = router owes the pool
    ///      (already holds the tokens via Permit2 pull, pays from its own
    ///      balance); positive delta = pool owes the payer, sent directly
    ///      back to them rather than left in the router.
    function _settleDelta(PoolKey memory key, BalanceDelta delta, address payer) internal {
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        if (amount0 < 0) {
            key.currency0.settle(poolManager, address(this), uint256(int256(-amount0)), false);
        } else if (amount0 > 0) {
            key.currency0.take(poolManager, payer, uint256(int256(amount0)), false);
        }

        if (amount1 < 0) {
            key.currency1.settle(poolManager, address(this), uint256(int256(-amount1)), false);
        } else if (amount1 > 0) {
            key.currency1.take(poolManager, payer, uint256(int256(amount1)), false);
        }
    }
}
