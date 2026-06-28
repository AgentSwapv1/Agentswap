// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// ERC-8004: Onchain AI Agent Identity and Reputation
/// Matches Arc testnet deployed contracts exactly.

// interface IIdentityRegistry {
//     function registerAgent(bytes32 agentId, string calldata metadataURI) external;
//     function getAgent(bytes32 agentId)
//         external view returns (address wallet, string memory metadataURI, bool active);
//     function deactivateAgent(bytes32 agentId) external;
// }
interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getAgentWallet(uint256 tokenId) external view returns (address);
}

interface IReputationRegistry {
    function getScore(bytes32 agentId)
        external view returns (uint256 score, uint256 totalJobs, uint256 lastUpdated);
    function recordEvent(
        bytes32 agentId,
        bytes32 jobId,
        uint256 score,
        string calldata eventType
    ) external;
}

interface IValidationRegistry {
    function requestValidation(
        bytes32 jobId,
        string calldata deliverableCID,
        string calldata rubric
    ) external;
    function submitAttestation(
        bytes32 jobId,
        bytes32 validatorId,
        uint256 verdict,
        uint256 confidence
    ) external;
}
