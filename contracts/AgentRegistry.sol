// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @notice UNDEPLOYED, UNAUDITED REFERENCE. Registration is a self-assertion.
contract AgentRegistry is IAgentRegistry {
    uint64 public constant MAX_SESSION_DURATION = 30 days;
    struct Agent { string endpoint; bytes32 capabilitiesHash; bool exists; bool active; }
    mapping(address => Agent) public agents;
    mapping(address => mapping(address => uint64)) public sessionKeyExpiry;

    error InvalidInput();
    error AlreadyRegistered();
    error InactiveAgent();

    modifier activeOwner() {
        if (!agents[msg.sender].active) revert InactiveAgent();
        _;
    }

    function register(string calldata endpoint, bytes32 capabilitiesHash) external {
        if (agents[msg.sender].exists) revert AlreadyRegistered();
        _validateEndpoint(endpoint);
        agents[msg.sender] = Agent(endpoint, capabilitiesHash, true, true);
        emit AgentRegistered(msg.sender, endpoint, capabilitiesHash);
    }

    function update(string calldata endpoint, bytes32 capabilitiesHash) external activeOwner {
        _validateEndpoint(endpoint);
        agents[msg.sender].endpoint = endpoint;
        agents[msg.sender].capabilitiesHash = capabilitiesHash;
        emit AgentUpdated(msg.sender, endpoint, capabilitiesHash);
    }

    /// @dev Permanent for this owner address; invalidates all its session keys.
    function revokeAgent() external activeOwner {
        agents[msg.sender].active = false;
        emit AgentRevoked(msg.sender);
    }

    function setSessionKey(address key, uint64 expiresAt) external activeOwner {
        if (key == address(0) || key == msg.sender || expiresAt <= block.timestamp ||
            uint256(expiresAt) > block.timestamp + MAX_SESSION_DURATION) revert InvalidInput();
        sessionKeyExpiry[msg.sender][key] = expiresAt;
        emit SessionKeySet(msg.sender, key, expiresAt);
    }

    function revokeSessionKey(address key) external activeOwner {
        delete sessionKeyExpiry[msg.sender][key];
        emit SessionKeyRevoked(msg.sender, key);
    }

    function isAuthorized(address owner, address signer) external view returns (bool) {
        return agents[owner].active && signer != address(0) &&
            (signer == owner || sessionKeyExpiry[owner][signer] > block.timestamp);
    }

    function _validateEndpoint(string calldata endpoint) private pure {
        if (bytes(endpoint).length == 0 || bytes(endpoint).length > 2048) revert InvalidInput();
    }
}
