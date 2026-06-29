// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IERC8004.sol";

/**
 * MockIdentityRegistry
 * Mirrors Arc testnet ERC-8004 IdentityRegistry interface exactly.
 * Use this for local/testnet deploys until Arc's real contracts are accessible.
 *
 * Arc testnet real address: 0x8004A818BFB912233c491871b3d84c89A494BD9e
 */
contract MockIdentityRegistry is IIdentityRegistry {
    struct Agent {
        address wallet;
        string metadataURI;
        bool active;
    }

    mapping(bytes32 => Agent) private _agents;

    event AgentRegistered(bytes32 indexed agentId, address wallet, string metadataURI);
    event AgentDeactivated(bytes32 indexed agentId);

    function registerAgent(bytes32 agentId, string calldata metadataURI) external {
        _agents[agentId] = Agent({wallet: msg.sender, metadataURI: metadataURI, active: true});
        emit AgentRegistered(agentId, msg.sender, metadataURI);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        // Convert tokenId to bytes32 and check if agent exists
        bytes32 agentId = bytes32(tokenId);
        // Return wallet if active, else address(0) (or revert)
        if (_agents[agentId].active) {
            return _agents[agentId].wallet;
        }
        return address(0);
    }

    function getAgentWallet(uint256 tokenId) external view returns (address) {
        bytes32 agentId = bytes32(tokenId);
        return _agents[agentId].wallet;
    }

    function getAgent(bytes32 agentId) external view returns (address wallet, string memory metadataURI, bool active) {
        Agent storage a = _agents[agentId];
        return (a.wallet, a.metadataURI, a.active);
    }

    function deactivateAgent(bytes32 agentId) external {
        require(_agents[agentId].wallet == msg.sender, "Not agent owner");
        _agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    // Admin: force-register for deploy scripts
    function adminRegister(bytes32 agentId, address wallet, string calldata metadataURI) external {
        _agents[agentId] = Agent({wallet: wallet, metadataURI: metadataURI, active: true});
        emit AgentRegistered(agentId, wallet, metadataURI);
    }
}

/**
 * MockReputationRegistry
 * Rolling weighted average score per agent.
 * Arc testnet real address: 0x8004B663056A597Dffe9eCcC1965A193B7388713
 */
contract MockReputationRegistry is IReputationRegistry {
    struct Record {
        uint256 score;
        uint256 totalJobs;
        uint256 lastUpdated;
    }

    mapping(bytes32 => Record) private _records;

    event ReputationEvent(bytes32 indexed agentId, bytes32 indexed jobId, uint256 score, string eventType);

    // Seed an agent with a starting score (called by deploy script)
    function seed(bytes32 agentId, uint256 initialScore) external {
        _records[agentId].score = initialScore;
    }

    function getScore(bytes32 agentId)
        external
        view
        override
        returns (uint256 score, uint256 totalJobs, uint256 lastUpdated)
    {
        Record storage r = _records[agentId];
        return (r.score, r.totalJobs, r.lastUpdated);
    }

    function recordEvent(bytes32 agentId, bytes32 jobId, uint256 score, string calldata eventType) external override {
        Record storage r = _records[agentId];
        // Weighted rolling average: new_score = (old * jobs + score) / (jobs + 1)
        if (r.totalJobs == 0) {
            r.score = score;
        } else {
            r.score = (r.score * r.totalJobs + score) / (r.totalJobs + 1);
        }
        r.totalJobs += 1;
        r.lastUpdated = block.timestamp;
        emit ReputationEvent(agentId, jobId, score, eventType);
    }
}

/**
 * MockUSDC
 * Standard ERC-20 USDC with 6 decimals.
 * On Arc testnet use Circle's real USDC: 0xFbDa5F676cB37624f28265A144A48B0d6e87d3b6
 */
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "USDC: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "USDC: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "USDC: insufficient allowance");
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
