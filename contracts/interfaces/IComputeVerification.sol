// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Historical interface name. This reference verifies signatures only.
///         It DOES NOT prove inference execution, output correctness, or model identity.
interface IComputeVerification {
    struct Receipt {
        address agent;
        address provider;
        bytes32 requestHash;
        bytes32 outputHash;
        bytes32 modelHash;
        bytes32 channelId;
        uint256 cumulativeAmount;
        uint64 completedAt;
        uint64 sequence;
    }
    event ReceiptSubmitted(bytes32 indexed receiptId, address indexed agent, address indexed provider, bytes32 requestHash, bytes32 outputHash);
    event DisputeOpened(bytes32 indexed receiptId, address indexed claimant, bytes32 evidenceHash);
    event DisputeResolved(bytes32 indexed receiptId, bytes32 resolutionHash);

    function submitReceipt(Receipt calldata receipt, bytes calldata providerSignature) external returns (bytes32 receiptId);
    function openDispute(bytes32 receiptId, bytes32 evidenceHash) external;
    function resolveDispute(bytes32 receiptId, bytes32 resolutionHash) external;
    function receiptDigest(Receipt calldata receipt) external view returns (bytes32);
}
