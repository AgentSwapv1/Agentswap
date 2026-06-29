// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IUniswapV4.sol";
import "./interfaces/IERC8004.sol";
import "./interfaces/IERC8183.sol";

/**
 * AgentSwapHook
 *
 * Uniswap v4 hook that embeds reputation-gated AI agents into every swap.
 *
 * DATA FLOW:
 * ─────────────────────────────────────────────────────────────────────
 *  [Offchain Agent]
 *      observes pending swap in mempool
 *      runs MEV detection / fee optimization
 *      signs AgentIntent{swapId, mevFlag, feeOverrideBps, timestamp}
 *      calls registerIntent() — lands in block N-1
 *
 *  [Block N — PoolManager calls hook]
 *      beforeSwap():
 *          1. reads pool config → gets assignedAgentId
 *          2. calls ERC-8004 ReputationRegistry.getScore(agentId)
 *          3. if score < minRepScore → revert (agent not qualified)
 *          4. reads pendingIntents[swapId]
 *          5. if mevFlag=true → revert MEVDetected (sandwich blocked)
 *          6. if feeOverrideBps set → return as lpFeeOverride
 *
 *      afterSwap():
 *          1. computes slippage saved vs baseline fee
 *          2. computes agentFee = amountIn * agentFeeBps / 10000
 *          3. transfers USDC to agent wallet (ERC-8183 settlement simulation)
 *          4. calls ERC-8004 ReputationRegistry.recordEvent(agentId, jobId, perfScore)
 *          5. emits AgentSettled
 * ─────────────────────────────────────────────────────────────────────
 */
contract AgentSwapHook is IHooks {
    // ── Immutables ───────────────────────────────────────────
    address public immutable poolManager;
    address public immutable identityRegistry;
    address public immutable reputationRegistry;
    address public immutable agenticCommerce;
    address public immutable usdc;
    address public owner;

    // ── Pool config ──────────────────────────────────────────
    struct PoolConfig {
        bytes32 assignedAgentId;
        address agentWallet;
        uint256 minRepScore; // e.g. 750
        uint256 agentFeeBps; // e.g. 5 = 0.05% of amountIn
        bool mevProtectionEnabled;
        bool dynamicFeeEnabled;
        bool active;
    }

    // ── Agent intent (submitted prior block) ─────────────────
    struct AgentIntent {
        bytes32 swapId;
        uint24 feeOverrideBps; // 0 = no override
        bool mevFlag;
        string mevEvidence;
        uint256 timestamp;
        bytes signature;
        bool exists;
    }

    // ── Swap outcome (written in beforeSwap, read in afterSwap) ─
    struct SwapOutcome {
        bytes32 agentId;
        int256 slippageSavedBps;
        bool mevBlocked;
        bool settled;
    }

    mapping(bytes32 => PoolConfig) public poolConfigs;
    mapping(bytes32 => AgentIntent) public pendingIntents;
    mapping(bytes32 => uint256) public swapBaseFees;
    mapping(bytes32 => SwapOutcome) public swapOutcomes;

    uint256 public constant MAX_BPS = 10000;
    uint256 public constant AGENT_FEE_FLOOR = 1000; // 0.001 USDC (6 decimals)

    // ── Events ───────────────────────────────────────────────
    event PoolConfigured(bytes32 indexed poolId, bytes32 agentId, uint256 minRepScore);
    event IntentRegistered(bytes32 indexed swapId, bool mevFlag, uint24 feeOverride);
    event SwapIntercepted(bytes32 indexed swapId, bool mevBlocked, uint24 feeApplied);
    event AgentSettled(bytes32 indexed swapId, bytes32 agentId, uint256 usdcPaid, uint256 perfScore);
    event MEVBlocked(bytes32 indexed swapId, bytes32 agentId, string evidence);

    // ── Errors ───────────────────────────────────────────────
    error NotPoolManager();
    error PoolNotConfigured();
    error AgentNotActive();
    error InsufficientReputation(uint256 required, uint256 actual);
    error SwapAlreadyProcessed();
    error MEVDetected(string evidence);
    error IntentExpired();

    constructor(
        address _poolManager,
        address _identityRegistry,
        address _reputationRegistry,
        address _usdc,
        address _agenticCommerce
    ) {
        poolManager = _poolManager;
        identityRegistry = _identityRegistry;
        reputationRegistry = _reputationRegistry;
        usdc = _usdc;
        agenticCommerce = _agenticCommerce;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyPoolManager() {
        if (msg.sender != poolManager) revert NotPoolManager();
        _;
    }

    // ── Pool configuration (called by deployer) ──────────────
    function configurePool(
        bytes32 poolId,
        bytes32 agentId,
        address agentWallet,
        uint256 minRepScore,
        uint256 agentFeeBps,
        bool mevProtection,
        bool dynamicFee
    ) external onlyOwner {
        address agentOwner = IIdentityRegistry(identityRegistry).ownerOf(uint256(agentId));
        if (agentOwner != agentWallet) revert AgentNotActive();

        poolConfigs[poolId] = PoolConfig({
            assignedAgentId: agentId,
            agentWallet: agentWallet,
            minRepScore: minRepScore,
            agentFeeBps: agentFeeBps,
            mevProtectionEnabled: mevProtection,
            dynamicFeeEnabled: dynamicFee,
            active: true
        });
        emit PoolConfigured(poolId, agentId, minRepScore);
    }

    // ── Agent registers intent (prior block) ─────────────────
    function registerIntent(
        bytes32 swapId,
        uint24 feeOverrideBps,
        bool mevFlag,
        string calldata mevEvidence,
        uint256 intentTimestamp,
        bytes calldata sig
    ) external {
        if (block.timestamp > intentTimestamp + 60) revert IntentExpired();

        bytes32 msgHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(swapId, feeOverrideBps, mevFlag, intentTimestamp))
            )
        );
        address signer = _recoverSigner(msgHash, sig);
        require(signer != address(0), "Bad signature");

        pendingIntents[swapId] = AgentIntent({
            swapId: swapId,
            feeOverrideBps: feeOverrideBps,
            mevFlag: mevFlag,
            mevEvidence: mevEvidence,
            timestamp: intentTimestamp,
            signature: sig,
            exists: true
        });
        emit IntentRegistered(swapId, mevFlag, feeOverrideBps);
    }

    // ── beforeSwap ───────────────────────────────────────────
    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata hookData)
        external
        override
        onlyPoolManager
        returns (bytes4, int256, uint24)
    {
        bytes32 swapId = abi.decode(hookData, (bytes32));
        bytes32 poolId = _poolId(key);

        PoolConfig storage cfg = poolConfigs[poolId];
        if (!cfg.active) revert PoolNotConfigured();

        // ERC-8004: reputation gate
        (uint256 repScore,,) = IReputationRegistry(reputationRegistry).getScore(cfg.assignedAgentId);
        if (repScore < cfg.minRepScore) {
            revert InsufficientReputation(cfg.minRepScore, repScore);
        }

        swapBaseFees[swapId] = key.fee;

        // Write outcome shell for afterSwap
        swapOutcomes[swapId] =
            SwapOutcome({agentId: cfg.assignedAgentId, slippageSavedBps: 0, mevBlocked: false, settled: false});

        AgentIntent storage intent = pendingIntents[swapId];
        uint24 feeOverride = 0;

        if (intent.exists) {
            // MEV shield: block the sandwich
            if (intent.mevFlag && cfg.mevProtectionEnabled) {
                emit MEVBlocked(swapId, cfg.assignedAgentId, intent.mevEvidence);
                swapOutcomes[swapId].mevBlocked = true;
                revert MEVDetected(intent.mevEvidence);
            }
            // Dynamic fee: apply agent's optimized fee
            if (intent.feeOverrideBps > 0 && cfg.dynamicFeeEnabled) {
                feeOverride = intent.feeOverrideBps;
            }
        }

        emit SwapIntercepted(swapId, false, feeOverride);
        return (this.beforeSwap.selector, 0, feeOverride);
    }

    // ── afterSwap ────────────────────────────────────────────
    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta calldata,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4, int128) {
        bytes32 swapId = abi.decode(hookData, (bytes32));
        bytes32 poolId = _poolId(key);

        PoolConfig storage cfg = poolConfigs[poolId];
        SwapOutcome storage outcome = swapOutcomes[swapId];
        if (outcome.settled) revert SwapAlreadyProcessed();

        // Slippage saved = base fee - override fee (in bps)
        AgentIntent storage intent = pendingIntents[swapId];
        if (intent.exists && intent.feeOverrideBps > 0) {
            uint256 base = swapBaseFees[swapId];
            if (base > intent.feeOverrideBps) {
                outcome.slippageSavedBps = int256(base - intent.feeOverrideBps);
            }
        }

        // Agent fee from swap amount
        uint256 amountIn = uint256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified);
        uint256 agentFee = (amountIn * cfg.agentFeeBps) / MAX_BPS;
        if (agentFee < AGENT_FEE_FLOOR) agentFee = AGENT_FEE_FLOOR;

        // Pay agent (ERC-8183 settlement — direct USDC transfer)
        bool paid = _payAgent(cfg.agentWallet, agentFee);

        // ERC-8004: record performance
        uint256 perfScore = _perfScore(outcome.slippageSavedBps, outcome.mevBlocked);
        bytes32 jobId = keccak256(abi.encodePacked(swapId, block.timestamp));
        try IReputationRegistry(reputationRegistry).recordEvent(
            cfg.assignedAgentId, jobId, perfScore, "swap_completion"
        ) {} catch {}

        outcome.settled = true;
        delete pendingIntents[swapId];

        emit AgentSettled(swapId, cfg.assignedAgentId, paid ? agentFee : 0, perfScore);
        return (this.afterSwap.selector, 0);
    }

    // ── Helpers ──────────────────────────────────────────────
    function _payAgent(address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) = usdc.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!ok) return false;
        uint256 bal = abi.decode(ret, (uint256));
        if (bal < amount) return false;
        (bool sent,) = usdc.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        return sent;
    }

    function _settleViaERC8183(
        bytes32 swapId,
        address agentWallet,
        bytes32 agentId,
        uint256 agentFee,
        int256 slippageSavedBps,
        bool mevBlocked
    ) internal returns (bool) {
        // Unique job ID per swap
        bytes32 jobId = keccak256(abi.encodePacked(swapId, block.timestamp, agentWallet));
        bytes32 deliverableHash =
            keccak256(abi.encodePacked(swapId, agentId, slippageSavedBps, mevBlocked, block.number));

        try IERC20Approve(usdc).approve(agenticCommerce, agentFee) {}
        catch {
            return false;
        }

        try IAgenticCommerce(agenticCommerce).createJob(
            jobId,
            agentWallet, // provider — the agent
            address(this), // evaluator — hook is self-evaluating
            usdc, // USDC payment
            agentFee,
            block.timestamp + 300
        ) {} catch {
            return false;
        }

        try IAgenticCommerce(agenticCommerce).fundEscrow(jobId) {}
        catch {
            return false;
        }
        try IAgenticCommerce(agenticCommerce).submitDeliverable(jobId, deliverableHash) {}
        catch {
            return false;
        }
        try IAgenticCommerce(agenticCommerce).completeJob(jobId) {}
        catch {
            return false;
        }

        return true;
    }

    function _perfScore(int256 savedBps, bool mevBlocked) internal pure returns (uint256) {
        if (mevBlocked) return 950;
        if (savedBps > 20) return 900;
        if (savedBps > 10) return 850;
        if (savedBps > 0) return 800;
        return 700;
    }

    function _poolId(PoolKey calldata key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key.currency0.token, key.currency1.token, key.fee, key.tickSpacing));
    }

    function _recoverSigner(bytes32 hash, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return ecrecover(hash, v, r, s);
    }

    // ── Admin ─────────────────────────────────────────────────
    function depositUSDC(uint256 amount) external {
        (bool ok,) = usdc.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
        );
        require(ok, "USDC transfer failed");
    }

    function withdrawUSDC(uint256 amount) external onlyOwner {
        (bool ok,) = usdc.call(abi.encodeWithSignature("transfer(address,uint256)", owner, amount));
        require(ok, "Withdraw failed");
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
