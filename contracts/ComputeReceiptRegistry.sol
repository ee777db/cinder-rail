// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IComputeVerification} from "./interfaces/IComputeVerification.sol";

/// @notice UNDEPLOYED, UNAUDITED REFERENCE. Signed provenance, never a ZK verifier.
/// @dev Resolver is explicitly trusted. Decisions are event records only and cannot
///      transfer funds, change vouchers, slash providers, or establish correctness.
contract ComputeReceiptRegistry is IComputeVerification, EIP712 {
    bytes32 public constant RECEIPT_TYPEHASH = keccak256(
        "Receipt(address agent,address provider,bytes32 requestHash,bytes32 outputHash,bytes32 modelHash,bytes32 channelId,uint256 cumulativeAmount,uint64 completedAt,uint64 sequence)"
    );
    address public immutable resolver;
    struct Record { address agent; address provider; uint8 disputeState; }
    mapping(bytes32 => Record) public records;

    error InvalidInput();
    error InvalidSignature();
    error DuplicateReceipt();
    error Unauthorized();
    error InvalidDisputeState();

    constructor(address resolver_) EIP712("CinderRailReceipts", "1") {
        if (resolver_ == address(0)) revert InvalidInput();
        resolver = resolver_;
    }

    function submitReceipt(Receipt calldata receipt, bytes calldata providerSignature)
        external returns (bytes32 receiptId)
    {
        if (receipt.agent == address(0) || receipt.provider == address(0) ||
            receipt.requestHash == bytes32(0) || receipt.outputHash == bytes32(0) ||
            receipt.modelHash == bytes32(0) || receipt.completedAt > block.timestamp) revert InvalidInput();
        receiptId = _receiptDigest(receipt);
        if (records[receiptId].provider != address(0)) revert DuplicateReceipt();
        if (ECDSA.recover(receiptId, providerSignature) != receipt.provider) revert InvalidSignature();
        records[receiptId] = Record(receipt.agent, receipt.provider, 0);
        emit ReceiptSubmitted(receiptId, receipt.agent, receipt.provider, receipt.requestHash, receipt.outputHash);
    }

    function openDispute(bytes32 receiptId, bytes32 evidenceHash) external {
        Record storage record = records[receiptId];
        if (record.provider == address(0) || (msg.sender != record.agent && msg.sender != record.provider)) revert Unauthorized();
        if (record.disputeState != 0) revert InvalidDisputeState();
        if (evidenceHash == bytes32(0)) revert InvalidInput();
        record.disputeState = 1;
        emit DisputeOpened(receiptId, msg.sender, evidenceHash);
    }

    function resolveDispute(bytes32 receiptId, bytes32 resolutionHash) external {
        if (msg.sender != resolver) revert Unauthorized();
        if (records[receiptId].disputeState != 1) revert InvalidDisputeState();
        if (resolutionHash == bytes32(0)) revert InvalidInput();
        records[receiptId].disputeState = 2;
        emit DisputeResolved(receiptId, resolutionHash);
    }

    function receiptDigest(Receipt calldata receipt) external view returns (bytes32) { return _receiptDigest(receipt); }

    function _receiptDigest(Receipt calldata receipt) private view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(RECEIPT_TYPEHASH, receipt.agent, receipt.provider,
            receipt.requestHash, receipt.outputHash, receipt.modelHash, receipt.channelId,
            receipt.cumulativeAmount, receipt.completedAt, receipt.sequence)));
    }
}
