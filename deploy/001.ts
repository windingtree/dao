/* eslint-disable camelcase */
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'
import { constants } from 'ethers'
import { TimelockController } from '../typechain'

const COMMUNITY_MULTI_SIG = '0x876969b13dcf884C13D4b4f003B69229E6b7966A'
const MIN_DELAY = 60 * 60 * 24 * 3 // 3 days

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
  const timelockControllerDeploy = await deploy('TimelockController', {
    from: deployer,
    log: true,
    autoMine: true,
    args: [MIN_DELAY, [COMMUNITY_MULTI_SIG], [constants.AddressZero]] // minimum delay, community multi-sig as only proposer and any executor
  })

  if (timelockControllerDeploy.newlyDeployed) {
    console.log(
      `TimelockController deployed at ${timelockControllerDeploy.address} using ${timelockControllerDeploy.receipt?.gasUsed} gas`
    )

    const timelockControllerFactory = await ethers.getContractFactory('TimelockController')
    const timelockController = timelockControllerFactory.attach(timelockControllerDeploy.address) as TimelockController

    // Set timelockcontroller as timelockcontroller admin.
    const tx = await timelockController.renounceRole(await timelockController.callStatic.TIMELOCK_ADMIN_ROLE(), deployer)
    const receipt = await tx.wait()

    console.log(receipt)
  }
}

export default func
func.tags = ['TimelockController']
