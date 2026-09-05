// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IMicropaymentChannel} from "./interfaces/IMicropaymentChannel.sol";

/// @notice UNDEPLOYED, UNAUDITED REFERENCE. Do not fund with real tokens.
/// @dev One immutable standard ERC20; no rebasing or transfer-fee support.
///      Receipt roots are signed commitments, not verified computation proofs.
contract MicropaymentChannel is IMicropaymentChannel, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    uint64 public constant MAX_CHANNEL_DURATION = 30 days;
    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(bytes32 channelId,address provider,uint256 cumulativeAmount,bytes32 receiptRoot,uint64 validUntil)"
    );
    struct Channel {
        address payer;
        address provider;
        uint256 deposit;
        uint256 settled;
        uint64 expiresAt;
        bool reclaimed;
    }
    mapping(bytes32 => Channel) public channels;
    mapping(address => uint256) public nonces;

    error InvalidInput();
    error InvalidTokenTransfer();
    error Unauthorized();
    error Expired();
    error NotExpired();
    error Closed();
    error InvalidAmount();
    error InvalidSignature();

    constructor(IERC20 token_) EIP712("CinderRailChannel", "1") {
        if (address(token_) == address(0) || address(token_).code.length == 0) revert InvalidInput();
        token = token_;
    }

    function open(address provider, uint256 deposit, uint64 expiresAt)
        external nonReentrant returns (bytes32 channelId)
    {
        if (provider == address(0) || provider == msg.sender || deposit == 0 ||
            expiresAt <= block.timestamp || uint256(expiresAt) > block.timestamp + MAX_CHANNEL_DURATION)
            revert InvalidInput();
        channelId = keccak256(abi.encode(block.chainid, address(this), msg.sender, provider, nonces[msg.sender]++));
        channels[channelId] = Channel(msg.sender, provider, deposit, 0, expiresAt, false);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), deposit);
        if (token.balanceOf(address(this)) != beforeBalance + deposit) revert InvalidTokenTransfer();
        emit ChannelOpened(channelId, msg.sender, provider, deposit, expiresAt);
    }

    /// @notice Provider settles cumulative payer-signed vouchers before channel expiry.
    /// @dev Duplicate cumulative values return zero, so replay cannot double-charge.
    function settle(Voucher calldata voucher, bytes calldata signature)
        external nonReentrant returns (uint256 delta)
    {
        Channel storage channel = channels[voucher.channelId];
        if (channel.payer == address(0) || msg.sender != channel.provider || voucher.provider != channel.provider)
            revert Unauthorized();
        if (channel.reclaimed) revert Closed();
        if (block.timestamp >= channel.expiresAt || voucher.validUntil < block.timestamp ||
            voucher.validUntil > channel.expiresAt) revert Expired();
        if (voucher.cumulativeAmount < channel.settled || voucher.cumulativeAmount > channel.deposit)
            revert InvalidAmount();
        if (ECDSA.recover(_voucherDigest(voucher), signature) != channel.payer) revert InvalidSignature();
        delta = voucher.cumulativeAmount - channel.settled;
        channel.settled = voucher.cumulativeAmount;
        if (delta != 0) token.safeTransfer(channel.provider, delta);
        emit Settled(voucher.channelId, voucher.cumulativeAmount, delta, voucher.receiptRoot);
    }

    /// @notice Payer recovers only the unsettled balance at/after the fixed deadline.
    function reclaim(bytes32 channelId) external nonReentrant returns (uint256 refund) {
        Channel storage channel = channels[channelId];
        if (channel.payer == address(0) || msg.sender != channel.payer) revert Unauthorized();
        if (channel.reclaimed) revert Closed();
        if (block.timestamp < channel.expiresAt) revert NotExpired();
        channel.reclaimed = true;
        refund = channel.deposit - channel.settled;
        if (refund != 0) token.safeTransfer(channel.payer, refund);
        emit Reclaimed(channelId, channel.payer, refund);
    }

    function voucherDigest(Voucher calldata voucher) external view returns (bytes32) {
        return _voucherDigest(voucher);
    }

    function _voucherDigest(Voucher calldata voucher) private view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, voucher.channelId, voucher.provider,
            voucher.cumulativeAmount, voucher.receiptRoot, voucher.validUntil)));
    }
}
