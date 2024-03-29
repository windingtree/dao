// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.13;

import '@openzeppelin/contracts/governance/TimelockController.sol';

contract MockTimelockController is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors
    ) TimelockController(minDelay, proposers, executors) {}
}
