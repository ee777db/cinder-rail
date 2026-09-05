// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMicropaymentChannel {
    struct Voucher {
        bytes32 channelId;
        address provider;
        uint256 cumulativeAmount;
        bytes32 receiptRoot;
        uint64 validUntil;
    }
    event ChannelOpened(bytes32 indexed channelId, address indexed payer, address indexed provider, uint256 deposit, uint64 expiresAt);
    event Settled(bytes32 indexed channelId, uint256 cumulativeAmount, uint256 delta, bytes32 receiptRoot);
    event Reclaimed(bytes32 indexed channelId, address indexed payer, uint256 amount);

    function open(address provider, uint256 deposit, uint64 expiresAt) external returns (bytes32 channelId);
    function settle(Voucher calldata voucher, bytes calldata signature) external returns (uint256 delta);
    function reclaim(bytes32 channelId) external returns (uint256 refund);
    function voucherDigest(Voucher calldata voucher) external view returns (bytes32);
}
