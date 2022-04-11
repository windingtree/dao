---
author: mfw78 <mfw78@protonmail.com>
---

# WT Smart Contract Template

## Overview

This is a template repository for smart contract development in **Hardhat**. This repository
contains the base tools required for testing, coverage analysis, and deployment. Tools
used include:

- ethers
- hardhat / hardhat-deploy
- openzeppelin
- typescript / typechain
- solhint / gas-reporter / soliditiy-coverage

## Commits

To commit to the repository after staging the commit:

```bash
yarn commit
```

Select the appropriate type of commit message, any issues to close, and note any breaking
changes.

## Tests

Test are handled with `chai` and includes `solidity-coverage`, enabling coverage
reports to be done for the code-base. By default, contracts located in `contracts/test`
are ignored by `solidity-coverage`.

## Deployment

### Requirements

1. Ensure **100% solidity coverage** in tests prior to production deployment.
2. All `Ownable` contracts **MUST** have their owner set to the community multi-sig and/or
   `TimelockController`. **NO** contracts must be allowed to retain **ANY** deployer addresses
   in their configurtion.
3. **MINIMUM** two reviewers prior to commiting to the main branch.

### Scripts

This repository uses `hardhat-deploy` for reproducible deployment tests, as well as:

1. Get contracts via name from `ethers`.
2. Named accounts for more readable tests.
3. Conditional logic execution based on tagged network deploying to (allowing for more
   complex logic when deploying across multiple chains, and/or testnets).

Deployment scripts are contained within `deploy`, and these deployment scripts are executed
prior to any tests, and are executed in **alphabetical order**.
