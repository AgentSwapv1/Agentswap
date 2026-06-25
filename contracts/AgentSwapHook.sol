// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────
//  AgentSwapHook
//  Uniswap v4 hook that gates swaps through
//  reputation-scored AI agents (ERC-8004) and
//  settles per-swap USDC micropayments via
//  ERC-8183 on Arc.
// ─────────────────────────────────────────────

struct PoolKey {
    address currency0;
    address currency1;
    uint24  fee;
    int24   tickSpacing;
    address hooks;
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
}

interface IIdentityRegistry {
    function getAgent(bytes32 agentId)
        external view returns (address wallet, string memory metadataURI, bool active);
}

interface IReputationRegistry {
    function getScore(bytes32 agentId)
        external view returns (uint256 score, uint256 totalJobs, uint256 lastUpdated);
    function recordEvent(bytes32 agentId, bytes32 jobId, uint256 score, string calldata eventType)
        external;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract AgentSwapHook {

    // ── Immutables ───────────────────────────
    address public immutable poolManager;
    address public immutable identityRegistry;
    address public immutable reputationRegistry;
    address public immutable usdc;
    address public owner;

    // ── Structs ──────────────────────────────
    struct PoolConfig {
        bytes32 assignedAgentId;
        address agentWallet;
        uint256 minRepScore;
        uint256 agentFeeBps;
        bool    mevProtectionEnabled;
        bool    dynamicFeeEnabled;
        bool    active;
    }

    struct AgentIntent {
        bytes32 swapId;
        uint24  feeOverrideBps;
        bool    mevFlag;
        string  mevEvidence;
        uint256 timestamp;
        bytes   signature;
        bool    exists;
    }

    struct SwapOutcome {
        bytes32 agentId;
        int256  slippageSavedBps;
        bool    mevBlocked;
        bool    settled;
    }

    // ── Storage ──────────────────────────────
    mapping(bytes32 => PoolConfig)   public poolConfigs;
    mapping(bytes32 => AgentIntent)  public pendingIntents;
    mapping(bytes32 => uint256)      public swapBaseFees;
    mapping(bytes32 => SwapOutcome)  public swapOutcomes;

    uint256 public constant MAX_BPS             = 10000;
    uint256 public constant AGENT_FEE_FLOOR     = 1000;   // 0.001 USDC (6 decimals)

    // ── Events ───────────────────────────────
    event PoolConfigured(bytes32 indexed poolId, bytes32 agentId, uint256 minRepScore);
    event IntentRegistered(bytes32 indexed swapId, bytes32 agentId, bool mevFlag, uint24 feeOverride);
    event SwapIntercepted(bytes32 indexed swapId, bool mevBlocked, uint24 feeApplied);
    event AgentSettled(bytes32 indexed swapId, bytes32 agentId, uint256 usdcPaid, uint256 perfScore);
    event MEVBlocked(bytes32 indexed swapId, bytes32 agentId, string evidence);

    // ── Errors ───────────────────────────────
    error NotPoolManager();
    error PoolNotConfigured();
    error AgentNotActive();
    error InsufficientReputation(uint256 required, uint256 actual);
    error SwapAlreadyProcessed();
    error MEVDetected(string evidence);

    // ── Constructor ──────────────────────────
    constructor(
        address _poolManager,
        address _identityRegistry,
        address _reputationRegistry,
        address _usdc
    ) {
        poolManager        = _poolManager;
        identityRegistry   = _identityRegistry;
        reputationRegistry = _reputationRegistry;
        usdc               = _usdc;
        owner              = msg.sender;
    }

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    // ── Pool Configuration ───────────────────
    function configurePool(
        bytes32 poolId,
        bytes32 agentId,
        address agentWallet,
        uint256 minRepScore,
        uint256 agentFeeBps,
        bool    mevProtection,
        bool    dynamicFee
    ) external onlyOwner {
        (,, bool active) = IIdentityRegistry(identityRegistry).getAgent(agentId);
        if (!active) revert AgentNotActive();

        poolConfigs[poolId] = PoolConfig({
            assignedAgentId:     agentId,
            agentWallet:         agentWallet,
            minRepScore:         minRepScore,
            agentFeeBps:         agentFeeBps,
            mevProtectionEnabled: mevProtection,
            dynamicFeeEnabled:   dynamicFee,
            active:              true
        });
        emit PoolConfigured(poolId, agentId, minRepScore);
    }

    // ── Intent Registration ──────────────────
    function registerIntent(
        bytes32      swapId,
        uint24       feeOverrideBps,
        bool         mevFlag,
        string calldata mevEvidence,
        uint256      intentTimestamp,
        bytes calldata sig
    ) external {
        require(block.timestamp <= intentTimestamp + 30, "Intent expired");

        bytes32 msgHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(swapId, feeOverrideBps, mevFlag, intentTimestamp))
        ));
        address signer = _recoverSigner(msgHash, sig);
        require(signer != address(0), "Bad signature");

        pendingIntents[swapId] = AgentIntent({
            swapId:        swapId,
            feeOverrideBps: feeOverrideBps,
            mevFlag:       mevFlag,
            mevEvidence:   mevEvidence,
            timestamp:     intentTimestamp,
            signature:     sig,
            exists:        true
        });
        emit IntentRegistered(swapId, bytes32(0), mevFlag, feeOverrideBps);
    }

    // ── beforeSwap ───────────────────────────
    function beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        bytes calldata hookData
    ) external returns (bytes4, int256, uint24) {
        if (msg.sender != poolManager) revert NotPoolManager();

        bytes32 swapId = abi.decode(hookData, (bytes32));
        bytes32 poolId = _poolId(key);
        PoolConfig storage cfg = poolConfigs[poolId];
        if (!cfg.active) revert PoolNotConfigured();

        // ERC-8004: reputation gate
        (uint256 repScore,,) = IReputationRegistry(reputationRegistry).getScore(cfg.assignedAgentId);
        if (repScore < cfg.minRepScore)
            revert InsufficientReputation(cfg.minRepScore, repScore);

        swapBaseFees[swapId] = key.fee;

        AgentIntent storage intent = pendingIntents[swapId];
        uint24 feeOverride = 0;

        if (intent.exists) {
            // MEV shield: block sandwich
            if (intent.mevFlag && cfg.mevProtectionEnabled) {
                emit MEVBlocked(swapId, cfg.assignedAgentId, intent.mevEvidence);
                swapOutcomes[swapId] = SwapOutcome({
                    agentId:         cfg.assignedAgentId,
                    slippageSavedBps: 0,
                    mevBlocked:      true,
                    settled:         false
                });
                revert MEVDetected(intent.mevEvidence);
            }
            // Dynamic fee: apply agent's optimized fee
            if (intent.feeOverrideBps > 0 && cfg.dynamicFeeEnabled) {
                feeOverride = intent.feeOverrideBps;
            }
        }

        // Shell outcome for afterSwap
        swapOutcomes[swapId] = SwapOutcome({
            agentId:         cfg.assignedAgentId,
            slippageSavedBps: 0,
            mevBlocked:      false,
            settled:         false
        });

        emit SwapIntercepted(swapId, false, feeOverride);
        return (this.beforeSwap.selector, 0, feeOverride);
    }

    // ── afterSwap ────────────────────────────
    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta calldata,
        bytes calldata hookData
    ) external returns (bytes4, int128) {
        if (msg.sender != poolManager) revert NotPoolManager();

        bytes32 swapId = abi.decode(hookData, (bytes32));
        bytes32 poolId = _poolId(key);
        PoolConfig storage cfg = poolConfigs[poolId];

        SwapOutcome storage outcome = swapOutcomes[swapId];
        if (outcome.settled) revert SwapAlreadyProcessed();

        // Compute slippage saved
        AgentIntent storage intent = pendingIntents[swapId];
        int256 savedBps = 0;
        if (intent.exists && intent.feeOverrideBps > 0) {
            uint256 base = swapBaseFees[swapId];
            if (base > intent.feeOverrideBps) {
                savedBps = int256(base) - int256(uint256(intent.feeOverrideBps));
            }
        }
        outcome.slippageSavedBps = savedBps;

        // Compute agent USDC payment
        uint256 amountIn = uint256(
            params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified
        );
        uint256 agentFee = (amountIn * cfg.agentFeeBps) / MAX_BPS;
        if (agentFee < AGENT_FEE_FLOOR) agentFee = AGENT_FEE_FLOOR;

        // Settle payment
        bool paid = _pay(cfg.agentWallet, agentFee);

        // ERC-8004: record performance event
        uint256 perfScore = _perfScore(savedBps, outcome.mevBlocked);
        bytes32 jobId = keccak256(abi.encodePacked(swapId, block.timestamp));
        try IReputationRegistry(reputationRegistry).recordEvent(
            cfg.assignedAgentId, jobId, perfScore, "swap_completion"
        ) {} catch {}

        outcome.settled = true;
        delete pendingIntents[swapId];

        emit AgentSettled(swapId, cfg.assignedAgentId, paid ? agentFee : 0, perfScore);
        return (this.afterSwap.selector, 0);
    }

    // ── Helpers ──────────────────────────────
    function _pay(address to, uint256 amount) internal returns (bool) {
        if (IERC20(usdc).balanceOf(address(this)) < amount) return false;
        return IERC20(usdc).transfer(to, amount);
    }

    function _perfScore(int256 savedBps, bool mevBlocked) internal pure returns (uint256) {
        if (mevBlocked)    return 950;
        if (savedBps > 20) return 900;
        if (savedBps > 10) return 850;
        if (savedBps > 0)  return 800;
        return 700;
    }

    function _poolId(PoolKey calldata key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing));
    }

    function _recoverSigner(bytes32 hash, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return ecrecover(hash, v, r, s);
    }

    // ── Admin ────────────────────────────────
    function depositUSDC(uint256 amount) external {
        IERC20(usdc).transferFrom(msg.sender, address(this), amount);
    }

    function withdrawUSDC(uint256 amount) external onlyOwner {
        IERC20(usdc).transfer(owner, amount);
    }

    function getPoolConfig(bytes32 poolId) external view returns (PoolConfig memory) {
        return poolConfigs[poolId];
    }

    function getPendingIntent(bytes32 swapId) external view returns (AgentIntent memory) {
        return pendingIntents[swapId];
    }

    function getSwapOutcome(bytes32 swapId) external view returns (SwapOutcome memory) {
        return swapOutcomes[swapId];
    }
}
