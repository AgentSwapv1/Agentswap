// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSD
/// @notice Minimal mintable ERC20 used to stand in for USDC/USDT on X Layer
///         testnet, where you don't yet have real stablecoin addresses.
///         Deploy two instances (e.g. "USDX" and "USDY") to form the pair
///         StableGuard protects. 6 decimals to mirror real USDC/USDT.
contract MockUSD is ERC20, Ownable {
    uint8 private constant _DECIMALS = 6;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) Ownable(msg.sender) {
        // Mint an initial supply to the deployer for seeding pool liquidity.
        _mint(msg.sender, 1_000_000 * 10 ** _DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Open faucet-style mint for demo/testing convenience.
    ///         Remove or gate this before any real deployment.
    function faucet(uint256 amount) external {
        require(amount <= 10_000 * 10 ** _DECIMALS, "faucet: amount too large");
        _mint(msg.sender, amount);
    }
}
