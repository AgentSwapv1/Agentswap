// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ERC-8183 AgenticCommerce — 0x0747EEf0706327138c69792bF28Cd525089e4583
interface IAgenticCommerce {
    enum JobStatus {
        Open,
        Funded,
        Active,
        Delivered,
        Completed,
        Rejected,
        Cancelled
    }

    struct Job {
        bytes32 jobId;
        address client;
        address provider;
        address evaluator;
        address paymentToken; // USDC on Arc
        uint256 paymentAmount;
        bytes32 deliverableHash;
        JobStatus status;
        uint256 createdAt;
        uint256 deadline;
    }

    event JobCreated(bytes32 indexed jobId, address indexed client, uint256 amount);
    event EscrowFunded(bytes32 indexed jobId, uint256 amount);
    event DeliverableSubmitted(bytes32 indexed jobId, bytes32 deliverableHash);
    event JobCompleted(bytes32 indexed jobId, address indexed provider, uint256 payout);
    event JobRejected(bytes32 indexed jobId);

    function createJob(
        bytes32 jobId,
        address provider,
        address evaluator,
        address paymentToken,
        uint256 paymentAmount,
        uint256 deadline
    ) external returns (bytes32);

    function fundEscrow(bytes32 jobId) external;
    function submitDeliverable(bytes32 jobId, bytes32 deliverableHash) external;
    function completeJob(bytes32 jobId) external;
    function rejectJob(bytes32 jobId) external;
    function getJob(bytes32 jobId) external view returns (Job memory);
}

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}
