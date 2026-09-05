// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only unrestricted mint; never deploy as a monetary asset.
contract MockToken is ERC20 {
    constructor() ERC20("TEST ONLY USD", "TESTUSD") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address recipient, uint256 amount) external { _mint(recipient, amount); }
}

/// @dev Re-enters the channel from the token transfer callback. Used only locally.
contract ReentrantToken is MockToken {
    address public target;
    bytes public payload;
    bool public attackEnabled;
    bool public attempted;
    bool public succeeded;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        attackEnabled = true;
        attempted = false;
        succeeded = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (attackEnabled) {
            attackEnabled = false;
            attempted = true;
            (succeeded,) = target.call(payload);
        }
        return super.transfer(to, amount);
    }

    function callChannel(address target_, bytes calldata payload_) external returns (bytes memory) {
        (bool ok, bytes memory result) = target_.call(payload_);
        require(ok, "Test call failed");
        return result;
    }
}

contract FeeToken is MockToken {
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool ok = super.transferFrom(from, to, amount);
        _burn(to, amount / 100);
        return ok;
    }
}
