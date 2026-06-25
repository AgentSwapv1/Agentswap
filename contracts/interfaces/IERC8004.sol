// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ERC-8004 IdentityRegistry — 0x8004A818BFB912233c491871b3d84c89A494BD9e
interface IIdentityRegistry {
    struct AgentIdentity {
        address owner;
        bytes32 agentId;
        string metadataURI;   // IPFS JSON: { capabilities[], pricingFloor, name }
        uint256 registeredAt;
        bool active;
    }
    function registerAgent(bytes32 agentId, string calldata metadataURI) external;
    function getAgent(bytes32 agentId) external view returns (AgentIdentity memory);
    function isRegistered(bytes32 agentId) external view returns (bool);
    function getAgentByOwner(address owner) external view returns (bytes32);
}

// ERC-8004 ReputationRegistry — 0x8004B663056A597Dffe9eCcC1965A193B7388713
interface IReputationRegistry {
    struct ReputationEvent {
        bytes32 agentId;
        bytes32 jobId;
        int256 scoreDelta;
        uint8 eventType;      // 0=completion 1=rejection 2=validation 3=mev_block
        uint256 timestamp;
    }
    function getScore(bytes32 agentId) external view returns (uint256);
    function recordEvent(
        bytes32 agentId,
        bytes32 jobId,
        int256 scoreDelta,
        uint8 eventType
    ) external;
    function getHistory(bytes32 agentId, uint256 limit)
        external view returns (ReputationEvent[] memory);
}

// ERC-8004 ValidationRegistry — 0x8004Cb1BF31DAf7788923b405b754f57acEB4272
interface IValidationRegistry {
    function requestValidation(
        bytes32 jobId,
        string calldata deliverableCID,
        string calldata rubricCID
    ) external returns (bytes32 validationId);
    function submitAttestation(
        bytes32 validationId,
        bytes32 validatorId,
        uint256 verdict,        // 0–1000 scaled
        uint256 confidence,
        string calldata rationaleCID
    ) external;
    function getResult(bytes32 validationId) external view returns (uint256 weightedVerdict);
}
