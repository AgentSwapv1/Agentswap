// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Mock IdentityRegistry (mirrors Arc testnet ERC-8004 interface)
contract MockIdentityRegistry {
    struct Agent {
        address wallet;
        string  metadataURI;
        bool    active;
    }
    mapping(bytes32 => Agent) public agents;

    event AgentRegistered(bytes32 indexed agentId, address wallet);

    function registerAgent(bytes32 agentId, address wallet, string calldata metadataURI) external {
        agents[agentId] = Agent({ wallet: wallet, metadataURI: metadataURI, active: true });
        emit AgentRegistered(agentId, wallet);
    }

    function getAgent(bytes32 agentId) external view returns (address wallet, string memory metadataURI, bool active) {
        Agent storage a = agents[agentId];
        return (a.wallet, a.metadataURI, a.active);
    }

    function deactivateAgent(bytes32 agentId) external {
        agents[agentId].active = false;
    }
}

// Mock ReputationRegistry
contract MockReputationRegistry {
    struct RepRecord {
        uint256 score;
        uint256 totalJobs;
        uint256 lastUpdated;
    }
    mapping(bytes32 => RepRecord) public records;

    event RepEventRecorded(bytes32 indexed agentId, bytes32 jobId, uint256 score, string eventType);

    function setScore(bytes32 agentId, uint256 score) external {
        records[agentId].score = score;
    }

    function getScore(bytes32 agentId) external view returns (uint256 score, uint256 totalJobs, uint256 lastUpdated) {
        RepRecord storage r = records[agentId];
        return (r.score, r.totalJobs, r.lastUpdated);
    }

    function recordEvent(bytes32 agentId, bytes32 jobId, uint256 score, string calldata eventType) external {
        RepRecord storage r = records[agentId];
        // Rolling weighted average: new = (old * jobs + score) / (jobs + 1)
        r.score = (r.score * r.totalJobs + score) / (r.totalJobs + 1);
        r.totalJobs += 1;
        r.lastUpdated = block.timestamp;
        emit RepEventRecorded(agentId, jobId, score, eventType);
    }
}

// Mock USDC ERC-20 for testing
contract MockUSDC {
    string public name     = "USD Coin";
    string public symbol   = "USDC";
    uint8  public decimals = 6;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}

// Mock PoolManager — simulates Uniswap v4 PoolManager calling hook callbacks
contract MockPoolManager {
    address public hook;

    constructor(address _hook) { hook = _hook; }

    struct PoolKey {
        address currency0;
        address currency1;
        uint24  fee;
        int24   tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool    zeroForOne;
        int256  amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    struct BalanceDelta {
        int128 amount0;
        int128 amount1;
    }

    event SwapExecuted(bytes32 swapId, bool mevBlocked, uint24 feeApplied);

    function executeSwap(
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) external returns (bool success, string memory reason) {
        // Call beforeSwap
        (bool ok, bytes memory ret) = hook.call(
            abi.encodeWithSignature(
                "beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)",
                msg.sender, key, params, hookData
            )
        );
        if (!ok) {
            // Decode revert reason
            if (ret.length > 4) {
                bytes memory revertData = new bytes(ret.length - 4);
                for (uint i = 4; i < ret.length; i++) revertData[i - 4] = ret[i];
                return (false, string(revertData));
            }
            return (false, "MEV blocked or error");
        }

        // Simulate swap execution
        BalanceDelta memory delta = BalanceDelta({
            amount0: int128(params.amountSpecified > 0 ? -int128(int256(params.amountSpecified)) : int128(0)),
            amount1: int128(params.amountSpecified < 0 ? int128(-int256(params.amountSpecified)) : int128(0))
        });

        // Call afterSwap
        (ok,) = hook.call(
            abi.encodeWithSignature(
                "afterSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),(int128,int128),bytes)",
                msg.sender, key, params, delta, hookData
            )
        );

        return (ok, ok ? "Swap completed" : "afterSwap failed");
    }
}
