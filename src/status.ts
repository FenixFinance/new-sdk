/* eslint-disable max-params */
/* eslint-disable @typescript-eslint/ban-types */
import {
  emptyExecution,
  Execution,
  Process,
  ProcessMessage,
  UpdateExecution,
} from './types'
import { deepClone } from './utils'

export const initStatus = (
  updateStatus?: (execution: Execution) => void,
  initialStatus?: Execution
) => {
  const status = initialStatus || (deepClone(emptyExecution) as Execution)
  // eslint-disable-next-line no-console
  const update = updateStatus || console.log
  if (!initialStatus) {
    update(status)
  }
  return { status, update }
}

export const createAndPushProcess = (
  id: string,
  updateStatus: (execution: Execution) => void,
  status: Execution,
  message: ProcessMessage,
  params?: object
): Process => {
  const process = status.process.find((p) => p.id === id)
  if (process) {
    status.status = 'PENDING'
    updateStatus(status)
    return process
  }
  const newProcess: Process = {
    id: id,
    startedAt: Date.now(),
    message: message,
    status: 'PENDING',
  }
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      newProcess[key] = value
    }
  }

  status.status = 'PENDING'
  status.process.push(newProcess)
  updateStatus(status)
  return newProcess
}

export const setStatusFailed = (
  updateStatus: UpdateExecution,
  status: Execution,
  currentProcess: Process,
  params?: object
): void => {
  status.status = 'FAILED'
  currentProcess.status = 'FAILED'
  currentProcess.failedAt = Date.now()
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      currentProcess[key] = value
    }
  }

  updateStatus(status)
}

export const setStatusCancelled = (
  updateStatus: UpdateExecution,
  status: Execution,
  currentProcess: Process,
  params?: object
): void => {
  currentProcess.status = 'CANCELLED'
  currentProcess.doneAt = Date.now()
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      currentProcess[key] = value
    }
  }
  updateStatus(status)
}

export const setStatusDone = (
  updateStatus: UpdateExecution,
  status: Execution,
  currentProcess: Process,
  params?: object
): void => {
  currentProcess.status = 'DONE'
  currentProcess.doneAt = Date.now()
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      currentProcess[key] = value
    }
  }
  updateStatus(status)
}
