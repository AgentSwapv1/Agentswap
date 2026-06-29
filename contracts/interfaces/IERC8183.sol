// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ERC-8183 AgenticCommerce — 0x0747EEf0706327138c69792bF28Cd525089e4583
interface IAgenticCommerce {
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId);

    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;
    function fund(uint256 jobId, bytes calldata optParams) external;
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external;
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
    function claimRefund(uint256 jobId) external;
    function getJob(uint256 jobId)
        external
        view
        returns (
            uint256 id,
            address client,
            address provider,
            address evaluator,
            string memory description,
            uint256 budget,
            uint256 expiredAt,
            uint8 status,
            address hook
        );
}
// interface IAgenticCommerce {
//     enum JobStatus {
//         Open,
//         Funded,
//         Active,
//         Delivered,
//         Completed,
//         Rejected,
//         Cancelled
//     }

//     struct Job {
//         bytes32 jobId;
//         address client;
//         address provider;
//         address evaluator;
//         address paymentToken; // USDC on Arc
//         uint256 paymentAmount;
//         bytes32 deliverableHash;
//         JobStatus status;
//         uint256 createdAt;
//         uint256 deadline;
//     }

//     event JobCreated(bytes32 indexed jobId, address indexed client, uint256 amount);
//     event EscrowFunded(bytes32 indexed jobId, uint256 amount);
//     event DeliverableSubmitted(bytes32 indexed jobId, bytes32 deliverableHash);
//     event JobCompleted(bytes32 indexed jobId, address indexed provider, uint256 payout);
//     event JobRejected(bytes32 indexed jobId);

//     function fundEscrow(bytes32 jobId) external;
//     function submitDeliverable(bytes32 jobId, bytes32 deliverableHash) external;
//     function completeJob(bytes32 jobId) external;
//     function rejectJob(bytes32 jobId) external;
//     function getJob(bytes32 jobId) external view returns (Job memory);
// }

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}
