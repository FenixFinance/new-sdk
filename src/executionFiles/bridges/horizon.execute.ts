/* eslint-disable no-console */
import BigNumber from 'bignumber.js'
import { EXCHANGE_MODE, NETWORK_TYPE, STATUS, TOKEN } from 'bridge-sdk'

import {
  createAndPushProcess,
  initStatus,
  setStatusDone,
  setStatusFailed,
} from '../../status'
import {
  ChainId,
  CoinKey,
  ExecuteCrossParams,
  getChainById,
  Process,
} from '../../types'
import horizon from './horizon'

export class HorizonExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean) => {
    this.shouldContinue = val
  }

  execute = async ({ signer, step, updateStatus }: ExecuteCrossParams) => {
    const { action, execution } = step
    // setup
    const { status, update } = initStatus(updateStatus, execution)
    const fromChain = getChainById(action.fromChainId)
    const toChain = getChainById(action.toChainId)

    const allowanceAndCrossProcess = createAndPushProcess(
      'allowanceAndCrossProcess',
      update,
      status,
      'Set Allowance and Cross',
      { status: 'ACTION_REQUIRED' }
    )
    let waitForBlocksProcess: Process
    let mintProcess: Process
    let intervalId: NodeJS.Timer
    if (!this.shouldContinue) return status

    try {
      // mainnet / testnet ?
      const bridgeSDK =
        action.fromChainId === ChainId.ONE || action.toChainId === ChainId.ONE
          ? await horizon.setupMainnet()
          : await horizon.setupTestnet()

      const tokenMapping: { [k: string]: any } = {
        [CoinKey.ETH]: {
          token: TOKEN.ETH,
        },
        [CoinKey.BNB]: {
          token: TOKEN.ETH,
          // for other direction
          // token: TOKEN.HRC20,
          // hrc20Address: '0xbef55684b382bae72051813a898d17282066c007',
        },
        [CoinKey.ONE]: {
          token: TOKEN.ONE,
        },
        // [CoinKey.USDC]: {
        //   token: TOKEN.ERC20,
        //   erc20Address: '',
        // },
      }

      // params
      const type =
        action.toChainId === ChainId.ONE || action.toChainId === ChainId.ONET
          ? EXCHANGE_MODE.ETH_TO_ONE
          : EXCHANGE_MODE.ONE_TO_ETH
      const network =
        action.fromChainId === ChainId.BSC ||
        action.fromChainId === ChainId.BSCT ||
        action.toChainId === ChainId.BSC ||
        action.toChainId === ChainId.BSCT
          ? NETWORK_TYPE.BINANCE
          : NETWORK_TYPE.ETHEREUM

      // coinKey should always be set since this data is coming from the Fenix Backend.
      if (!action.fromToken.coinKey) {
        console.error("fromToken doesn't contain coinKey, aborting")
        throw new Error("fromToken doesn't contain coinKey")
      }
      const token = tokenMapping[action.fromToken.coinKey].token

      const amount = new BigNumber(action.fromAmount)
        .shiftedBy(-action.fromToken.decimals)
        .toNumber()
      const erc20Address = tokenMapping[action.fromToken.coinKey].erc20Address
      const hrc20Address = tokenMapping[action.fromToken.coinKey].hrc20Address

      const params = {
        type,
        network,
        amount,
        token,
        erc20Address,
        oneAddress: action.toAddress!,
        ethAddress: action.toAddress!,
        hrc20Address: hrc20Address,
        // maxWaitingTime?: number;
      }
      console.debug('params', params)

      if (!this.shouldContinue) return status
      let operationId: string
      let bridgePromise
      if (
        allowanceAndCrossProcess.operationId &&
        allowanceAndCrossProcess.txHash
      ) {
        operationId = allowanceAndCrossProcess.operationId
        const operation = await bridgeSDK.restoreOperationById(operationId)
        bridgePromise = operation.waitOperationComplete()
      } else {
        bridgePromise = bridgeSDK.sendToken(params, (id) => (operationId = id))
      }

      intervalId = setInterval(async () => {
        if (!this.shouldContinue) {
          clearInterval(intervalId)
          return status
        }
        if (operationId) {
          allowanceAndCrossProcess.operationId = operationId
          update(status)
          const operation = await bridgeSDK.api.getOperation(operationId)
          console.debug('operation', operation)

          // Send > Wait
          if (
            operation.actions[0].status === 'in_progress' &&
            allowanceAndCrossProcess.status === 'ACTION_REQUIRED'
          ) {
            allowanceAndCrossProcess.status = 'PENDING'
            allowanceAndCrossProcess.txHash =
              operation.actions[0].transactionHash
            allowanceAndCrossProcess.txLink =
              fromChain.metamask.blockExplorerUrls[0] +
              'tx/' +
              allowanceAndCrossProcess.txHash
            allowanceAndCrossProcess.message = 'Send Transaction - Wait for'
            update(status)
          }

          // Wait > Done; Wait for confirmations
          if (
            operation.actions[0].status === 'success' &&
            allowanceAndCrossProcess.status === 'PENDING'
          ) {
            allowanceAndCrossProcess.message = 'Transaction Sent:'
            setStatusDone(update, status, allowanceAndCrossProcess)
            waitForBlocksProcess = createAndPushProcess(
              'waitForBlocksProcess',
              update,
              status,
              'Wait for Block Confirmations',
              { status: 'PENDING' }
            )
          }

          // Confirmed > Done; Wait for mint
          if (
            operation.actions[1].status === 'success' &&
            waitForBlocksProcess.status === 'PENDING'
          ) {
            waitForBlocksProcess.message = 'Enough Block Confirmations'
            setStatusDone(update, status, waitForBlocksProcess)
            mintProcess = createAndPushProcess(
              'mintProcess',
              update,
              status,
              'Minting tokens',
              {
                status: 'PENDING',
              }
            )
          }

          // Minted > Done; ??
          if (
            operation.actions[2].status === 'success' &&
            mintProcess.status === 'PENDING'
          ) {
            mintProcess.txHash = operation.actions[2].transactionHash
            mintProcess.txLink =
              toChain.metamask.blockExplorerUrls[0] + 'tx/' + mintProcess.txHash
            mintProcess.message = 'Minted in'
            setStatusDone(update, status, mintProcess)
          }

          // Ended
          if (operation.status !== STATUS.IN_PROGRESS) {
            clearInterval(intervalId)
            if (operation.status === STATUS.ERROR) {
              //TODO: find appropriate message for error
              // const lastStep: Process = status.process[status.process.length -1]
              // lastStep.errorMessage = operation.status
              // update( status )
              if (
                allowanceAndCrossProcess &&
                allowanceAndCrossProcess.status !== 'DONE'
              )
                setStatusFailed(update, status, allowanceAndCrossProcess)
              if (
                waitForBlocksProcess! &&
                waitForBlocksProcess.status !== 'DONE'
              )
                setStatusFailed(update, status, waitForBlocksProcess)
              if (mintProcess! && mintProcess.status !== 'DONE')
                setStatusFailed(update, status, mintProcess)
            }
          }
        }
      }, 4000)

      await bridgePromise
      if (!this.shouldContinue) return status
      // Fallback
      if (
        allowanceAndCrossProcess &&
        allowanceAndCrossProcess.status !== 'DONE'
      )
        setStatusDone(update, status, allowanceAndCrossProcess)
      if (waitForBlocksProcess! && waitForBlocksProcess.status !== 'DONE')
        setStatusDone(update, status, waitForBlocksProcess)
      if (mintProcess! && mintProcess.status !== 'DONE')
        setStatusDone(update, status, mintProcess)
    } catch (e: any) {
      clearInterval(intervalId!)
      const lastStep: Process = status.process[status.process.length - 1]
      lastStep.errorMessage = (e as Error).message
      update(status)
      if (
        allowanceAndCrossProcess &&
        allowanceAndCrossProcess.status !== 'DONE'
      )
        setStatusFailed(update, status, allowanceAndCrossProcess)
      if (waitForBlocksProcess! && waitForBlocksProcess.status !== 'DONE')
        setStatusFailed(update, status, waitForBlocksProcess)
      if (mintProcess! && mintProcess.status !== 'DONE')
        setStatusFailed(update, status, mintProcess)
      throw e
    }

    // DONE
    status.status = 'DONE'
    update(status)
    return status
  }
}
