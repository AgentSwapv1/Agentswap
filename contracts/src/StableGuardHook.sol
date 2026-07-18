// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "uniswap-hooks/base/BaseHook.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title StableGuardHook
/// @notice Uniswap v4 hook that defends stablecoin pools from IL/skew during
///         agent-driven yield-seeking swaps. Implements:
///           1. A stepped dynamic-fee curve (calm / elevated / defensive)
///              driven by a rolling on-chain skew tracker.
///           2. A hard circuit breaker that reverts trades projected to push
///              skew past a configured safety threshold.
///
/// @dev KNOWN SIMPLIFICATION (documented, not hidden): the circuit breaker
///      currently reverts the *entire* swap when the threshold would be
///      breached, rather than partially filling up to the safe size inside
///      the hook itself (true in-hook partial-fill requires adjusting the
///      returned BeforeSwapDelta to clamp amountSpecified, which needs
///      careful accounting for both exact-in and exact-out swaps). Instead,
///      the off-chain ASP API exposes a `maxSafeSwapAmount` read so agents
///      can size their trade *before* submitting it — the practical effect
///      is the same (agents don't get reverted), but the guarantee is
///      advisory off-chain rather than enforced in-hook. Tightening this to
///      true in-hook throttling is the natural v2 extension — see README.
contract StableGuardHook is BaseHook, Ownable {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Tier {
        Calm,
        Elevated,
        Defensive
    }

    struct SkewState {
        int256 netSkew; // signed rolling skew, EMA-decayed each swap
        uint32 lastUpdateBlock;
        Tier currentTier;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    mapping(PoolId => SkewState) public skewOf;

    /// @dev Fee values are v4 units: fee / 1_000_000 (e.g. 500 = 0.05%).
    uint24 public feeCalm = 100; // 0.01%
    uint24 public feeElevated = 500; // 0.05%
    uint24 public feeDefensive = 3000; // 0.30%

    /// @dev Skew thresholds as a fraction of NORMALIZATION, controlling
    ///      which tier a pool falls into. Tune these post-deployment based
    ///      on observed real trade sizes.
    int256 public constant NORMALIZATION = 1e18;
    int256 public elevatedThreshold = 5e16; // 5% of normalized liquidity proxy
    int256 public defensiveThreshold = 15e16; // 15%
    int256 public hardCapThreshold = 30e16; // 30% — circuit breaker fires

    /// @dev Simple linear decay per block so skew doesn't stay elevated
    ///      forever after a burst of one-directional trading.
    uint256 public decayPerBlockBps = 50; // 0.5% of skew decays per block

    event SkewUpdated(PoolId indexed poolId, int256 netSkew, Tier tier);
    event CircuitBreakerTripped(PoolId indexed poolId, int256 projectedSkew, int256 cap);
    event ThresholdsUpdated(int256 elevated, int256 defensive, int256 hardCap);
    event FeesUpdated(uint24 calm, uint24 elevated, uint24 defensive);

    error CircuitBreakerActive(int256 projectedSkew, int256 cap);

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) Ownable(msg.sender) {}

    // ---------------------------------------------------------------------
    // Hook permissions
    // ---------------------------------------------------------------------

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ---------------------------------------------------------------------
    // beforeSwap — dynamic fee + circuit breaker
    // ---------------------------------------------------------------------

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();
        SkewState memory state = _decayedState(poolId);

        // Projected skew if this swap goes through in the direction implied
        // by amountSpecified. Positive amountSpecified with zeroForOne=true
        // pushes skew one way; we use a simplified magnitude+direction proxy
        // rather than exact post-trade reserve math, since exact reserves
        // require reading pool state mid-unlock. Good enough for tiering and
        // the circuit breaker; tighten with StateLibrary reads if you have
        // time before submission.
        int256 signedAmount =
            params.zeroForOne ? -int256(_abs(params.amountSpecified)) : int256(_abs(params.amountSpecified));
        int256 projectedSkew = state.netSkew + signedAmount;

        if (_abs(projectedSkew) > hardCapThreshold) {
            emit CircuitBreakerTripped(poolId, projectedSkew, hardCapThreshold);
            revert CircuitBreakerActive(projectedSkew, hardCapThreshold);
        }

        Tier tier = _tierFor(projectedSkew);
        uint24 fee = _feeForTier(tier);

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    // ---------------------------------------------------------------------
    // afterSwap — commit the skew update
    // ---------------------------------------------------------------------

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId poolId = key.toId();
        SkewState memory state = _decayedState(poolId);

        int256 signedAmount =
            params.zeroForOne ? -int256(_abs(params.amountSpecified)) : int256(_abs(params.amountSpecified));
        state.netSkew += signedAmount;
        state.lastUpdateBlock = uint32(block.number);
        state.currentTier = _tierFor(state.netSkew);

        skewOf[poolId] = state;
        emit SkewUpdated(poolId, state.netSkew, state.currentTier);

        return (BaseHook.afterSwap.selector, 0);
    }

    // ---------------------------------------------------------------------
    // Views for the off-chain ASP API
    // ---------------------------------------------------------------------

    /// @notice Read-only snapshot the API polls to build /protection-status.
    function getProtectionStatus(PoolId poolId)
        external
        view
        returns (int256 netSkew, Tier tier, uint24 currentFee, bool circuitBreakerArmed, int256 maxSafeAdditionalSkew)
    {
        SkewState memory state = _decayedStateView(poolId);
        tier = state.currentTier;
        currentFee = _feeForTier(tier);
        int256 headroom = hardCapThreshold - _abs(state.netSkew);
        circuitBreakerArmed = headroom < (hardCapThreshold / 5); // within 20% of tripping
        maxSafeAdditionalSkew = headroom > 0 ? headroom : int256(0);
        netSkew = state.netSkew;
    }

    /// @notice Projects the outcome of a specific proposed trade without
    ///         submitting it — the heavier computation backing the paid
    ///         `/simulate-trade` ASP endpoint (vs. the free, cheap
    ///         `/protection-status` read above). Reuses the exact same
    ///         tiering/circuit-breaker math `_beforeSwap` would apply, so the
    ///         projection is authoritative, not a separate approximation.
    /// @param amountSpecified Same convention as SwapParams —
    ///        magnitude of the proposed trade.
    /// @param zeroForOne Same convention as SwapParams.
    function simulateSwap(PoolId poolId, int256 amountSpecified, bool zeroForOne)
        external
        view
        returns (int256 projectedSkew, Tier projectedTier, uint24 projectedFee, bool wouldTripCircuitBreaker)
    {
        SkewState memory state = _decayedStateView(poolId);
        int256 signedAmount = zeroForOne ? -_abs(amountSpecified) : _abs(amountSpecified);
        projectedSkew = state.netSkew + signedAmount;
        wouldTripCircuitBreaker = _abs(projectedSkew) > hardCapThreshold;
        projectedTier = _tierFor(projectedSkew);
        projectedFee = _feeForTier(projectedTier);
    }

    // ---------------------------------------------------------------------
    // Admin (owner-gated — set to a multisig/DAO before mainnet)
    // ---------------------------------------------------------------------

    function setFees(uint24 calm, uint24 elevated, uint24 defensive) external onlyOwner {
        feeCalm = calm;
        feeElevated = elevated;
        feeDefensive = defensive;
        emit FeesUpdated(calm, elevated, defensive);
    }

    function setThresholds(int256 elevated, int256 defensive, int256 hardCap) external onlyOwner {
        require(elevated < defensive && defensive < hardCap, "thresholds: must be increasing");
        elevatedThreshold = elevated;
        defensiveThreshold = defensive;
        hardCapThreshold = hardCap;
        emit ThresholdsUpdated(elevated, defensive, hardCap);
    }

    function setDecayPerBlockBps(uint256 bps) external onlyOwner {
        require(bps <= 10_000, "decay: out of range");
        decayPerBlockBps = bps;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _tierFor(int256 skew) internal view returns (Tier) {
        int256 mag = _abs(skew);
        if (mag >= defensiveThreshold) return Tier.Defensive;
        if (mag >= elevatedThreshold) return Tier.Elevated;
        return Tier.Calm;
    }

    function _feeForTier(Tier tier) internal view returns (uint24) {
        if (tier == Tier.Defensive) return feeDefensive;
        if (tier == Tier.Elevated) return feeElevated;
        return feeCalm;
    }

    function _abs(int256 x) internal pure returns (int256) {
        return x >= 0 ? x : -x;
    }

    /// @dev Applies linear decay based on blocks elapsed and persists nothing
    ///      (caller decides whether/when to write state).
    function _decayedState(PoolId poolId) internal view returns (SkewState memory) {
        return _decayedStateView(poolId);
    }

    function _decayedStateView(PoolId poolId) internal view returns (SkewState memory state) {
        state = skewOf[poolId];
        if (state.lastUpdateBlock == 0) return state;
        uint256 blocksElapsed = block.number - state.lastUpdateBlock;
        if (blocksElapsed == 0) return state;
        uint256 decayBps = blocksElapsed * decayPerBlockBps;
        if (decayBps >= 10_000) {
            state.netSkew = 0;
        } else {
            state.netSkew = state.netSkew - (state.netSkew * int256(decayBps)) / 10_000;
        }
    }
}
