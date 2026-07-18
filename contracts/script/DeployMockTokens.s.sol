// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {MockUSD} from "../src/mocks/MockUSD.sol";

/// @notice Deploys the two mock stablecoins used to form the StableGuard
///         demo pool. Run this first, then paste the printed addresses into
///         contracts/.env as MOCK_USDX_ADDRESS / MOCK_USDY_ADDRESS.
contract DeployMockTokens is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        MockUSD usdx = new MockUSD("StableGuard Mock USD X", "USDX");
        MockUSD usdy = new MockUSD("StableGuard Mock USD Y", "USDY");

        vm.stopBroadcast();

        console.log("MOCK_USDX_ADDRESS=", address(usdx));
        console.log("MOCK_USDY_ADDRESS=", address(usdy));
    }
}
