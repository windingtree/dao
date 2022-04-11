import { Contract } from 'ethers'
import { ethers } from 'hardhat'

/**
 * A helper function that assists with connecting to contracts from an EOA.
 * @param addresses array of user addresses to connect to applicable contracts
 * @param contracts contracts that are being connected to from a user
 * @returns an array of users with their connected contracts
 */
export async function setupUsers<T extends { [contractName: string]: Contract }>(
  addresses: string[],
  contracts: T
): Promise<({ address: string } & T)[]> {
  const users: ({ address: string } & T)[] = []
  for (const address of addresses) {
    users.push(await setupUser(address, contracts))
  }
  return users
}

/**
 * A helper function to connect to contracts from a specific user.
 * @param address the address used to connect to the contracts
 * @param contracts contracts to connect to
 * @returns an object of connected contracts
 */
export async function setupUser<T extends { [contractName: string]: Contract }>(
  address: string,
  contracts: T
): Promise<{ address: string } & T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user: any = { address }
  for (const key of Object.keys(contracts)) {
    user[key] = contracts[key].connect(await ethers.getSigner(address))
  }
  return user as { address: string } & T
}
