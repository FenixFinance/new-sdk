import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/providers'
import { constants } from 'ethers'

import Fenix from '../../Fenix'
import {
  createAndPushProcess,
  initStatus,
  setStatusDone,
  setStatusFailed,
} from '../../status'
import { ExecuteSwapParams, getChainById } from '../../types'
import { personalizeStep } from '../../utils'
import { checkAllowance } from '../allowance.execute'
import { balanceCheck } from '../balanceCheck.execute'

export class SwapExecutionManager {
  shouldContinue = true

  setShouldContinue = (val: boolean) => {
    this.shouldContinue = val
  }

  execute = async ({
    signer,
    step,
    parseReceipt,
    updateStatus,
  }: ExecuteSwapParams) => {
    // setup
    const { action, execution, estimate } = step
    const fromChain = getChainById(action.fromChainId)
    const { status, update } = initStatus(updateStatus, execution)

    // Approval
    if (action.fromToken.address !== constants.AddressZero) {
      if (!this.shouldContinue) return status
      await checkAllowance(
        signer,
        fromChain,
        action.fromToken,
        action.fromAmount,
        estimate.approvalAddress,
        update,
        status,
        true
      )
    }

    // Start Swap
    // -> set status
    const swapProcess = createAndPushProcess(
      'swapProcess',
      update,
      status,
      'Preparing Swap'
    )

    // -> swapping
    let tx: TransactionResponse
    try {
      if (swapProcess.txHash) {
        // -> restore existing tx
        tx = await signer.provider!.getTransaction(swapProcess.txHash)
      } else {
        // -> check balance
        await balanceCheck(signer, step)

        // -> get tx from backend
        const personalizedStep = await personalizeStep(signer, step)
        const { transactionRequest } = await Fenix.getStepTransaction(
          personalizedStep
        )
        if (!transactionRequest) {
          swapProcess.errorMessage = 'Unable to prepare Transaction'
          setStatusFailed(update, status, swapProcess)
          throw swapProcess.errorMessage
        }

        // -> set status
        swapProcess.status = 'ACTION_REQUIRED'
        swapProcess.message = `Sign Transaction`
        update(status)
        if (!this.shouldContinue) return status // stop before user interaction is needed

        // -> submit tx
        tx = await signer.sendTransaction(transactionRequest)
      }
    } catch (e: any) {
      // -> set status
      if (e.message) swapProcess.errorMessage = e.message
      if (e.code) swapProcess.errorCode = e.code
      setStatusFailed(update, status, swapProcess)
      throw e
    }

    // Wait for Transaction
    // -> set status
    swapProcess.status = 'PENDING'
    swapProcess.txHash = tx.hash
    swapProcess.txLink =
      fromChain.metamask.blockExplorerUrls[0] + 'tx/' + swapProcess.txHash
    swapProcess.message = `Swapping - Wait for`
    update(status)

    // -> waiting
    let receipt: TransactionReceipt
    try {
      receipt = await tx.wait()
    } catch (e: any) {
      // -> set status
      if (e.code === 'TRANSACTION_REPLACED' && e.replacement) {
        swapProcess.txHash = e.replacement.hash
        swapProcess.txLink =
          fromChain.metamask.blockExplorerUrls[0] + 'tx/' + swapProcess.txHash
        receipt = e.replacement
      } else {
        if (e.message) swapProcess.errorMessage = e.message
        if (e.code) swapProcess.errorCode = e.code
        setStatusFailed(update, status, swapProcess)
        throw e
      }
    }

    // -> set status
    const parsedReceipt = await parseReceipt(tx, receipt)
    swapProcess.message = 'Swapped:'
    status.fromAmount = parsedReceipt.fromAmount
    status.toAmount = parsedReceipt.toAmount
    // status.gasUsed = parsedReceipt.gasUsed
    status.status = 'DONE'
    setStatusDone(update, status, swapProcess)

    // DONE
    return status
  }
}
