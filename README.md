---
author: mfw78 <mfw78@protonmail.com>
---

# WindingTree DAO

## Overview

This repository contains the smart contracts deployed for Governance use by WindingTree DAO.

Currently the following tools are deployed:

- [`TimelockController`](https://etherscan.io/address/0xaeb7b8808ce9afc9730846ec81880b57658734dc)

## TimelockController

The `TimelockController` is designed to provide a _time-delay_ mechanism for Governance Functions.
For information relating to the administration and configuration of the `TimelockController`,
please refer to the [OpenZeppelin documentation](https://docs.openzeppelin.com/contracts/4.x/api/governance#TimelockController).

Current configuration (may be verified on chain):

- `DEFAULT_ADMIN_ROLE`: N/A
- `TIMELOCK_ADMIN_ROLE`: `0xAEB7b8808ce9afc9730846Ec81880B57658734dC` (self-administered)
- `PROPOSAL_ROLE`: `0x876969b13dcf884C13D4b4f003B69229E6b7966A` (community multi-sig)
- `EXECUTOR_ROLE`: `0x0000000000000000000000000000000000000000` (Permissionless execution)
