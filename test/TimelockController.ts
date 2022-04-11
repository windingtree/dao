import { ethers, getNamedAccounts, deployments, getUnnamedAccounts } from 'hardhat'

import { setupUser, setupUsers } from './utils'

import { expect } from './chai-setup'
import { constants } from 'ethers'
import { TimelockController } from '../typechain'

const COMMUNITY_MULTI_SIG = '0x876969b13dcf884C13D4b4f003B69229E6b7966A'
const MIN_DELAY = 60 * 60 * 24 * 3 // 3 days

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'
const TIMELOCK_ADMIN_ROLE = '0x5f58e3a2316349923ce3780f8d587db2d72378aed66a8261c916544fa6846ca5'
const PROPOSER_ROLE = '0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1'
const EXECUTOR_ROLE = '0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63'

const setup = deployments.createFixture(async () => {
  await deployments.fixture('TimelockController')
  const { deployer, alice, bob, carol } = await getNamedAccounts()
  const contracts = {
    timelockController: (await ethers.getContract('TimelockController')) as TimelockController
  }
  const users = await setupUsers(await getUnnamedAccounts(), contracts)

  return {
    users,
    deployer: await setupUser(deployer, contracts),
    alice: await setupUser(alice, contracts),
    bob: await setupUser(bob, contracts),
    carol: await setupUser(carol, contracts),
    ...contracts
  }
})

describe('TimelockController', function () {
  let deployer: { address: string } & { timelockController: TimelockController }
  let alice: { address: string } & { timelockController: TimelockController }

  beforeEach('load fixture', async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({ deployer, alice } = await setup())
  })

  context('access controls set correctly', async () => {
    it('deployer does not have any roles', async () => {
      expect(await alice.timelockController.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).to.be.equal(false)
      expect(await alice.timelockController.hasRole(TIMELOCK_ADMIN_ROLE, deployer.address)).to.be.equal(false)
      expect(await alice.timelockController.hasRole(PROPOSER_ROLE, deployer.address)).to.be.equal(false)
      expect(await alice.timelockController.hasRole(EXECUTOR_ROLE, deployer.address)).to.be.equal(false)
    })
    it('timelock controller is itself a timelock admin', async () => {
      expect(await alice.timelockController.hasRole(TIMELOCK_ADMIN_ROLE, alice.timelockController.address)).to.be.equal(true)
    })
    it('community multi-sig is NOT a timelock admin', async () => {
      expect(await alice.timelockController.hasRole(TIMELOCK_ADMIN_ROLE, COMMUNITY_MULTI_SIG)).to.be.equal(false)
    })
    it('community multi-sig is a proposer', async () => {
      expect(await alice.timelockController.hasRole(PROPOSER_ROLE, COMMUNITY_MULTI_SIG)).to.be.equal(true)
    })
    it('any address is an executor', async () => {
      expect(await alice.timelockController.hasRole(EXECUTOR_ROLE, constants.AddressZero)).to.be.equal(true)
    })
  })

  context('parameters set correctly', async () => {
    it('set minimum delay to 3 days', async () => {
      expect(await alice.timelockController.getMinDelay()).to.be.equal(MIN_DELAY)
    })
  })
})
