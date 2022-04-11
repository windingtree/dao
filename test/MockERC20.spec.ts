import { ethers, getNamedAccounts, deployments, getUnnamedAccounts } from 'hardhat'

import { setupUser, setupUsers } from './utils'

import { IERC20Metadata as IERC20 } from '../typechain'
import { expect } from './chai-setup'
import { utils } from 'ethers'

const setup = deployments.createFixture(async () => {
  await deployments.fixture('MockERC20')
  const { deployer, alice, bob, carol } = await getNamedAccounts()
  const contracts = {
    erc20: (await ethers.getContract('MockERC20')) as IERC20
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

describe('MockERC20', function () {
  // let users: ({ address: string } & { erc20: IERC20 })[]
  let alice: { address: string } & { erc20: IERC20 }
  let bob: { address: string } & { erc20: IERC20 }
  let carol: { address: string } & { erc20: IERC20 }

  beforeEach('load fixture', async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({ alice, bob, carol } = await setup())
  })

  context('Metadata', async () => {
    it('sets symbol correctly', async () => {
      expect(await alice.erc20.symbol()).to.be.eq('MTK')
      expect(await alice.erc20.name()).to.be.eq('MockERC20')
    })
  })

  context('Allocations', async () => {
    it('gives correct amount to alice', async () => {
      expect(await alice.erc20.balanceOf(alice.address)).to.be.eq(utils.parseEther('1000000'))
    })
    it('gives correct amount to bob', async () => {
      expect(await bob.erc20.balanceOf(alice.address)).to.be.eq(utils.parseEther('1000000'))
    })
    it('gives correct amount to carol', async () => {
      expect(await carol.erc20.balanceOf(alice.address)).to.be.eq(utils.parseEther('1000000'))
    })
  })
})
