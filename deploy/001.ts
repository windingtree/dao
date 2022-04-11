/* eslint-disable camelcase */
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { MockERC20 } from '../typechain'
import { ethers } from 'hardhat'
import { utils } from 'ethers'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments

  const { deployer, alice, bob, carol } = await getNamedAccounts()

  // --- Account listing ---
  console.log(`Deployer: ${deployer}`)
  console.log(`Alice: ${alice}`)
  console.log(`Bob: ${bob}`)
  console.log(`Carol: ${carol}`)

  // --- Deploy the contract
  const mockErc20Deploy = await deploy('MockERC20', {
    from: deployer,
    log: true,
    autoMine: true // speed up deployment on local network, no effect on live network.
  })

  if (mockErc20Deploy.newlyDeployed) {
    console.log(
      `Contract MockERC20 deployed at ${mockErc20Deploy.address} using ${mockErc20Deploy.receipt?.gasUsed} gas`
    )

    const erc20Factory = await ethers.getContractFactory('MockERC20')
    const erc20 = erc20Factory.attach(mockErc20Deploy.address) as MockERC20

    // mint tokens to each address
    const NUM_TOKENS = utils.parseEther('1000000')
    await erc20.mint(alice, NUM_TOKENS)
    await erc20.mint(bob, NUM_TOKENS)
    await erc20.mint(carol, NUM_TOKENS)
  }
}

export default func
func.tags = ['MockERC20']
