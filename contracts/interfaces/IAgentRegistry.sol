// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Endpoint and expiring session-key directory; no personhood or reputation claim.
interface IAgentRegistry {
    event AgentRegistered(address indexed owner, string endpoint, bytes32 capabilitiesHash);
    event AgentUpdated(address indexed owner, string endpoint, bytes32 capabilitiesHash);
    event AgentRevoked(address indexed owner);
    event SessionKeySet(address indexed owner, address indexed key, uint64 expiresAt);
    event SessionKeyRevoked(address indexed owner, address indexed key);

    function register(string calldata endpoint, bytes32 capabilitiesHash) external;
    function update(string calldata endpoint, bytes32 capabilitiesHash) external;
    function revokeAgent() external;
    function setSessionKey(address key, uint64 expiresAt) external;
    function revokeSessionKey(address key) external;
    function isAuthorized(address owner, address signer) external view returns (bool);
}
