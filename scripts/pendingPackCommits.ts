import { spawn } from 'child_process'

interface CommitEvent {
  user: string
  packId: string
  blockNumber: number
  transactionHash: string
}

interface RevealEvent {
  user: string
  packId: string
  blockNumber: number
}

interface PendingCommit {
  user: string
  packId: string
  commitVersion: 'v0' | 'v1'
  commitTransactionHash: string
  commitBlockNumber: number
  revealIdx?: string
}

async function runCast(command: string[], retries = 10): Promise<string> {
  // Log the command being executed
  console.error(`    $ cast ${command.join(' ')}`)

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const proc = spawn('cast', command)
        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString()
        })

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })

        proc.on('close', (code: number) => {
          if (code !== 0) {
            // Check if it's a rate limit error (HTTP 429)
            const isRateLimitError =
              stderr.includes('HTTP error 429') ||
              stderr.includes('request rate is too high') ||
              stderr.includes('rate limit') ||
              stderr.includes('slow down')

            // Check if it's a retryable error (HTTP errors, network errors, timeouts)
            const isRetryableError =
              isRateLimitError ||
              stderr.includes('HTTP error 500') ||
              stderr.includes('HTTP error 502') ||
              stderr.includes('HTTP error 503') ||
              stderr.includes('HTTP error 504') ||
              stderr.includes('Bad gateway') ||
              stderr.includes('Service unavailable') ||
              stderr.includes('Gateway timeout') ||
              stderr.includes('origin request failed') ||
              stderr.includes('timeout') ||
              stderr.includes('tcp connect error') ||
              stderr.includes('Network is unreachable') ||
              stderr.includes('error sending request') ||
              stderr.includes('Connect') ||
              stderr.includes('connection') ||
              stderr.includes('Connection')

            if (isRetryableError) {
              const errorType = isRateLimitError
                ? 'RATE_LIMIT'
                : 'RETRYABLE_ERROR'
              reject(new Error(`${errorType}: ${stderr}`))
            } else {
              reject(new Error(`cast exited with code ${code}: ${stderr}`))
            }
          } else {
            resolve(stdout.trim())
          }
        })
      })
    } catch (error: any) {
      const isRateLimitError =
        error.message?.includes('RATE_LIMIT') ||
        error.message?.includes('HTTP error 429') ||
        error.message?.includes('request rate is too high') ||
        error.message?.includes('rate limit') ||
        error.message?.includes('slow down')

      const isRetryableError =
        isRateLimitError ||
        error.message?.includes('RETRYABLE_ERROR') ||
        error.message?.includes('RPC_ERROR') ||
        error.message?.includes('HTTP error 500') ||
        error.message?.includes('HTTP error 502') ||
        error.message?.includes('HTTP error 503') ||
        error.message?.includes('HTTP error 504') ||
        error.message?.includes('Bad gateway') ||
        error.message?.includes('Service unavailable') ||
        error.message?.includes('Gateway timeout') ||
        error.message?.includes('origin request failed') ||
        error.message?.includes('tcp connect error') ||
        error.message?.includes('Network is unreachable') ||
        error.message?.includes('error sending request') ||
        error.message?.includes('Connect') ||
        error.message?.includes('connection') ||
        error.message?.includes('Connection')

      if (isRetryableError && attempt < retries - 1) {
        // Use 1 minute delay for rate limits, exponential backoff for other errors
        const delay = isRateLimitError
          ? 60000 * 2 // 2 minute for rate limits
          : Math.pow(2, attempt) * 10000 // Exponential backoff: 10s, 20s, 40s for other errors

        const errorType = isRateLimitError ? 'Rate limit' : 'Network/RPC'
        console.error(
          `  ⚠️  ${errorType} error (attempt ${
            attempt + 1
          }/${retries}), retrying in ${delay / 1000}s...`,
        )
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      throw error
    }
  }
  throw new Error('Failed after retries')
}

async function getLatestBlock(rpcUrl: string): Promise<number> {
  const result = await runCast(['block-number', '--rpc-url', rpcUrl])
  return parseInt(result, 10)
}

async function getContractCode(
  rpcUrl: string,
  address: string,
  blockNumber?: number,
): Promise<string> {
  const args = ['code', address, '--rpc-url', rpcUrl]
  if (blockNumber !== undefined) {
    args.push('--block', blockNumber.toString())
  }
  return await runCast(args)
}

async function findDeploymentBlock(
  rpcUrl: string,
  packAddress: string,
  latestBlock: number,
): Promise<number> {
  console.error('🔍 Finding contract deployment block...')

  // Check if contract exists at latest block
  const latestCode = await getContractCode(rpcUrl, packAddress, latestBlock)
  if (latestCode === '0x' || latestCode === '') {
    throw new Error('Contract does not exist at latest block')
  }

  // Binary search for deployment block
  let low = 1
  let high = latestBlock
  let deploymentBlock = latestBlock

  console.error(`  Searching between block 1 and ${latestBlock}...`)

  // Binary search
  let iterations = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const code = await getContractCode(rpcUrl, packAddress, mid)

    if (code !== '0x' && code !== '') {
      // Contract exists at this block, deployment block is at or before this
      deploymentBlock = mid
      high = mid - 1
    } else {
      // Contract doesn't exist at this block, deployment block is after this
      low = mid + 1
    }

    iterations++
    // Show progress every 5 iterations
    if (iterations % 5 === 0) {
      console.error(`    Checking block ${mid} (range: ${low}-${high})...`)
    }
  }

  console.error(`  ✓ Contract deployed at block ${deploymentBlock}`)
  return deploymentBlock
}

async function getCommitEvents(
  rpcUrl: string,
  packAddress: string,
  fromBlock: number,
  toBlock: number,
  logChunkSize?: number,
): Promise<CommitEvent[]> {
  // Event signature: Commit(address indexed user, uint256 packId)
  // Topic 0: keccak256("Commit(address,uint256)")
  const eventSignature = 'Commit(address,uint256)'
  const topic0 = await runCast(['sig-event', eventSignature])

  const events: CommitEvent[] = []
  const blockRange = toBlock - fromBlock

  // Chunk requests if logChunkSize is specified and block range exceeds it
  if (logChunkSize && blockRange > logChunkSize) {
    console.error(
      `  Chunking log requests: ${blockRange} blocks in chunks of ${logChunkSize}...`,
    )

    // Create all chunk ranges
    const chunks: Array<{ from: number; to: number }> = []
    let currentFrom = fromBlock
    while (currentFrom <= toBlock) {
      const currentTo = Math.min(currentFrom + logChunkSize - 1, toBlock)
      chunks.push({ from: currentFrom, to: currentTo })
      currentFrom = currentTo + 1
    }

    const totalChunks = chunks.length
    const batchSize = 10 // Run 10 requests in parallel
    let processedChunks = 0

    // Process chunks in batches
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize)
      const batchPromises = batch.map(async (chunk, idx) => {
        const chunkNum = i + idx + 1
        console.error(
          `  [${chunkNum}/${totalChunks}] Fetching blocks ${chunk.from} to ${chunk.to}...`,
        )

        const logs = await runCast([
          'logs',
          '--json',
          '--from-block',
          chunk.from.toString(),
          '--to-block',
          chunk.to.toString(),
          '--address',
          packAddress,
          '--rpc-url',
          rpcUrl,
          topic0,
        ])

        if (logs) {
          return parseCommitLogs(logs)
        }
        return []
      })

      const batchResults = await Promise.all(batchPromises)
      for (const chunkEvents of batchResults) {
        events.push(...chunkEvents)
      }

      processedChunks += batch.length
      console.error(`  ✓ Processed ${processedChunks}/${totalChunks} chunks`)
    }
  } else {
    // Single request for entire range
    const logs = await runCast([
      'logs',
      '--json',
      '--from-block',
      fromBlock.toString(),
      '--to-block',
      toBlock.toString(),
      '--address',
      packAddress,
      '--rpc-url',
      rpcUrl,
      topic0,
    ])

    if (!logs) {
      return []
    }

    const parsedEvents = parseCommitLogs(logs)
    events.push(...parsedEvents)
  }

  return events
}

function parseCommitLogs(logs: string): CommitEvent[] {
  const events: CommitEvent[] = []

  // Parse JSON logs (cast logs --json returns a JSON array)
  let logArray: any[] = []
  try {
    // Try parsing as JSON array first
    logArray = JSON.parse(logs)
    if (!Array.isArray(logArray)) {
      // If not an array, try parsing line by line (newline-delimited JSON)
      const lines = logs.split('\n').filter((line: string) => line.trim())
      logArray = lines.map(line => JSON.parse(line))
    }
  } catch (error) {
    console.error(`⚠️  Warning: Failed to parse logs as JSON: ${error}`)
    return []
  }

  for (const log of logArray) {
    try {
      // Extract block number (always hex in JSON-RPC format)
      let blockNumber = 0
      if (log.blockNumber) {
        if (typeof log.blockNumber === 'string') {
          blockNumber = parseInt(log.blockNumber, 16) // Always hex in JSON-RPC
        } else {
          blockNumber = parseInt(log.blockNumber.toString(), 10)
        }
      }
      if (isNaN(blockNumber)) {
        console.error(
          `⚠️  Warning: Invalid block number in log, skipping: ${JSON.stringify(
            log,
          )}`,
        )
        continue
      }

      // Extract transaction hash
      const transactionHash = log.transactionHash || log.hash || ''
      if (!transactionHash || !transactionHash.startsWith('0x')) {
        console.error(
          `⚠️  Warning: Invalid transaction hash in log, skipping: ${JSON.stringify(
            log,
          )}`,
        )
        continue
      }

      // Extract topics (topic0 is event signature, topic1 is user address, topic2 is packId)
      if (!log.topics || log.topics.length < 2) {
        console.error(
          `⚠️  Warning: Missing topics in log, skipping: ${JSON.stringify(
            log,
          )}`,
        )
        continue
      }

      // topic1 is the indexed address (padded to 32 bytes)
      const userTopic = log.topics[1]
      if (!userTopic || userTopic.length < 66) {
        // 0x + 64 hex chars
        console.error(
          `⚠️  Warning: Invalid user topic in log, skipping: ${JSON.stringify(
            log,
          )}`,
        )
        continue
      }
      const user = '0x' + userTopic.slice(-40).toLowerCase()

      // topic2 is the indexed packId (padded to 32 bytes)
      // Note: packId might be 0 and topic2 might be missing
      const packIdTopic = log.topics[2] || '0x0'
      let packId = '0'
      try {
        packId = BigInt(packIdTopic).toString()
      } catch (error) {
        console.error(
          `⚠️  Warning: Invalid packId topic "${packIdTopic}", using 0`,
        )
        packId = '0'
      }

      events.push({
        user,
        packId,
        blockNumber,
        transactionHash,
      })
    } catch (error) {
      console.error(
        `⚠️  Warning: Failed to process log: ${JSON.stringify(
          log,
        )}, error: ${error}`,
      )
      continue
    }
  }

  return events
}

async function getRevealEvents(
  rpcUrl: string,
  packAddress: string,
  fromBlock: number,
  toBlock: number,
  logChunkSize?: number,
): Promise<RevealEvent[]> {
  // Event signature: Reveal(address user, uint256 packId)
  const eventSignature = 'Reveal(address,uint256)'
  const topic0 = await runCast(['sig-event', eventSignature])

  const events: RevealEvent[] = []
  const blockRange = toBlock - fromBlock

  // Chunk requests if logChunkSize is specified and block range exceeds it
  if (logChunkSize && blockRange > logChunkSize) {
    console.error(
      `  Chunking log requests: ${blockRange} blocks in chunks of ${logChunkSize}...`,
    )

    // Create all chunk ranges
    const chunks: Array<{ from: number; to: number }> = []
    let currentFrom = fromBlock
    while (currentFrom <= toBlock) {
      const currentTo = Math.min(currentFrom + logChunkSize - 1, toBlock)
      chunks.push({ from: currentFrom, to: currentTo })
      currentFrom = currentTo + 1
    }

    const totalChunks = chunks.length
    const batchSize = 10 // Run 10 requests in parallel
    let processedChunks = 0

    // Process chunks in batches
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize)
      const batchPromises = batch.map(async (chunk, idx) => {
        const chunkNum = i + idx + 1
        console.error(
          `  [${chunkNum}/${totalChunks}] Fetching blocks ${chunk.from} to ${chunk.to}...`,
        )

        const logs = await runCast([
          'logs',
          '--json',
          '--from-block',
          chunk.from.toString(),
          '--to-block',
          chunk.to.toString(),
          '--address',
          packAddress,
          '--rpc-url',
          rpcUrl,
          topic0,
        ])

        if (logs) {
          return parseRevealLogs(logs)
        }
        return []
      })

      const batchResults = await Promise.all(batchPromises)
      for (const chunkEvents of batchResults) {
        events.push(...chunkEvents)
      }

      processedChunks += batch.length
      console.error(`  ✓ Processed ${processedChunks}/${totalChunks} chunks`)
    }
  } else {
    // Single request for entire range
    const logs = await runCast([
      'logs',
      '--json',
      '--from-block',
      fromBlock.toString(),
      '--to-block',
      toBlock.toString(),
      '--address',
      packAddress,
      '--rpc-url',
      rpcUrl,
      topic0,
    ])

    if (!logs) {
      return []
    }

    const parsedEvents = parseRevealLogs(logs)
    events.push(...parsedEvents)
  }

  return events
}

function parseRevealLogs(logs: string): RevealEvent[] {
  const events: RevealEvent[] = []

  // Parse JSON logs (cast logs --json returns a JSON array)
  let logArray: any[] = []
  try {
    // Try parsing as JSON array first
    logArray = JSON.parse(logs)
    if (!Array.isArray(logArray)) {
      // If not an array, try parsing line by line (newline-delimited JSON)
      const lines = logs.split('\n').filter((line: string) => line.trim())
      logArray = lines.map(line => JSON.parse(line))
    }
  } catch (error) {
    console.error(`⚠️  Warning: Failed to parse reveal logs as JSON: ${error}`)
    return []
  }

  for (const log of logArray) {
    try {
      // Extract block number (always hex in JSON-RPC format)
      let blockNumber = 0
      if (log.blockNumber) {
        if (typeof log.blockNumber === 'string') {
          blockNumber = parseInt(log.blockNumber, 16) // Always hex in JSON-RPC
        } else {
          blockNumber = parseInt(log.blockNumber.toString(), 10)
        }
      }
      if (isNaN(blockNumber)) {
        console.error(
          `⚠️  Warning: Invalid block number in reveal log, skipping: ${JSON.stringify(
            log,
          )}`,
        )
        continue
      }

      // Reveal event has no indexed parameters, decode from data
      const data = log.data || '0x'
      if (!data || data.length < 130) {
        // 0x + 128 hex chars (64 bytes)
        console.error(
          `⚠️  Warning: Invalid data in reveal log, skipping: ${JSON.stringify(
            log,
          )}`,
        )
        continue
      }

      // Decode: address (32 bytes padded) + uint256 (32 bytes)
      const user = '0x' + data.slice(26, 66).toLowerCase() // Skip 0x and padding
      const packId = BigInt('0x' + data.slice(66, 130)).toString()

      events.push({
        user,
        packId,
        blockNumber,
      })
    } catch (error) {
      console.error(
        `⚠️  Warning: Failed to process reveal log: ${JSON.stringify(
          log,
        )}, error: ${error}`,
      )
      continue
    }
  }

  return events
}

async function getStorageSlot(
  rpcUrl: string,
  packAddress: string,
  slot: string,
): Promise<string> {
  const result = await runCast([
    'storage',
    packAddress,
    slot,
    '--rpc-url',
    rpcUrl,
  ])
  return result.trim()
}

async function calculateStorageSlotV0(
  user: string,
  packId: string,
  commitmentsSlot: number,
): Promise<string> {
  // v0: mapping(address => mapping(uint256 => uint256))
  // To access _commitments[user][packId]:
  // First level: keccak256(abi.encode(user, S))
  // Final slot: keccak256(abi.encode(packId, firstLevelSlot))
  const firstEncoded = await runCast([
    'abi-encode',
    'encode(address,uint256)',
    user,
    commitmentsSlot.toString(),
  ])
  const firstSlot = await runCast(['keccak256', firstEncoded])
  const firstSlotNum = BigInt(firstSlot)
  const secondEncoded = await runCast([
    'abi-encode',
    'encode(uint256,uint256)',
    packId,
    firstSlotNum.toString(),
  ])
  const finalSlot = await runCast(['keccak256', secondEncoded])
  return finalSlot
}

async function calculateStorageSlotV1(
  packId: string,
  user: string,
  commitmentsSlot: number,
): Promise<string> {
  // v1: mapping(uint256 => mapping(address => uint256))
  // To access _commitments[packId][user]:
  // First level: keccak256(abi.encode(packId, S))
  // Final slot: keccak256(abi.encode(user, firstLevelSlot))
  const firstEncoded = await runCast([
    'abi-encode',
    'encode(uint256,uint256)',
    packId,
    commitmentsSlot.toString(),
  ])
  const firstSlot = await runCast(['keccak256', firstEncoded])
  const firstSlotNum = BigInt(firstSlot)
  const secondEncoded = await runCast([
    'abi-encode',
    'encode(address,uint256)',
    user,
    firstSlotNum.toString(),
  ])
  const finalSlot = await runCast(['keccak256', secondEncoded])
  return finalSlot
}

async function checkCommitmentPending(
  rpcUrl: string,
  packAddress: string,
  user: string,
  packId: string,
  commitmentsSlot: number,
): Promise<{ pending: boolean; version: 'v0' | 'v1' | null }> {
  // Try v1 first (current version: mapping(uint256 => mapping(address => uint256)))
  const slotV1 = await calculateStorageSlotV1(packId, user, commitmentsSlot)
  const valueV1 = await getStorageSlot(rpcUrl, packAddress, slotV1)

  if (
    valueV1 !==
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    console.error(
      `    ✓ Found pending commit (v1) at slot ${slotV1}, value: ${valueV1}`,
    )
    return { pending: true, version: 'v1' }
  }

  // Try v0 (old version: mapping(address => mapping(uint256 => uint256)))
  const slotV0 = await calculateStorageSlotV0(user, packId, commitmentsSlot)
  const valueV0 = await getStorageSlot(rpcUrl, packAddress, slotV0)

  if (
    valueV0 !==
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    console.error(
      `    ✓ Found pending commit (v0) at slot ${slotV0}, value: ${valueV0}`,
    )
    return { pending: true, version: 'v0' }
  }

  console.error(
    `    ✗ No pending commit found (v1 slot: ${slotV1}, v0 slot: ${slotV0})`,
  )
  return { pending: false, version: null }
}

type CommitmentStatus =
  | { status: 'pending_reveal'; revealIdx: string }
  | { status: 'revealed' }
  | { status: 'expired_refund' }
  | { status: 'no_commit' }

/**
 * Checks the status of a commitment by calling getRevealIdx().
 *
 * Note: This function cannot differentiate between "never committed" and "revealed"
 * because both cases result in NoCommit() error (commitment slot is 0 in both cases).
 * The caller must use context (e.g., checking if a Commit event exists) to determine
 * which case it is. In practice, if you're checking commits from Commit events,
 * NoCommit() means "revealed".
 */
async function checkCommitmentStatus(
  rpcUrl: string,
  packAddress: string,
  user: string,
  packId: string,
): Promise<CommitmentStatus> {
  try {
    // Call getRevealIdx(address,uint256)
    const functionSig = 'getRevealIdx(address,uint256)'
    const calldata = await runCast(['calldata', functionSig, user, packId])

    const result = await runCast([
      'call',
      packAddress,
      calldata,
      '--rpc-url',
      rpcUrl,
    ])

    const trimmedResult = result.trim()

    // If the call succeeds, reveal is available
    // Success case: result is a hex-encoded uint256 (64 hex chars + 0x = 66 chars)
    if (
      trimmedResult !== '' &&
      trimmedResult.startsWith('0x') &&
      trimmedResult.length === 66 &&
      !trimmedResult.includes('0x08c379a0')
    ) {
      // Parse the revealIdx from the result (it's a uint256, so 32 bytes)
      // The result is already hex-encoded, convert to decimal string
      const revealIdx = BigInt(trimmedResult).toString()
      return { status: 'pending_reveal', revealIdx }
    }

    // Check for custom error selectors (4 bytes = 10 chars: 0x + 8 hex)
    if (trimmedResult.startsWith('0x') && trimmedResult.length === 10) {
      if (trimmedResult === '0xfbd0656a') {
        return { status: 'revealed' } // NoCommit()
      } else if (trimmedResult === '0xb7b33787') {
        return { status: 'expired_refund' } // InvalidCommit()
      }
    }

    // If it contains revert data (Error(string) or custom error in longer format)
    // Error signatures:
    // - NoCommit(): 0xfbd0656a
    // - InvalidCommit(): 0xb7b33787
    if (
      trimmedResult.includes('0x08c379a0') ||
      trimmedResult.includes('fbd0656a') ||
      trimmedResult.includes('b7b33787')
    ) {
      // This is a revert with reason or custom error
      // Try to decode the error selector
      if (trimmedResult.includes('fbd0656a')) {
        return { status: 'revealed' }
      } else if (trimmedResult.includes('b7b33787')) {
        return { status: 'expired_refund' }
      }
    }

    return { status: 'no_commit' }
  } catch (error: any) {
    // Parse error message to determine status
    const errorMsg = error.message || ''
    if (errorMsg.includes('NoCommit') || errorMsg.includes('no commit')) {
      return { status: 'revealed' }
    } else if (
      errorMsg.includes('InvalidCommit') ||
      errorMsg.includes('invalid commit')
    ) {
      return { status: 'expired_refund' }
    } else if (
      errorMsg.includes('AllPacksOpened') ||
      errorMsg.includes('all packs opened')
    ) {
      // All packs opened - commitment might still exist but can't reveal
      return { status: 'expired_refund' }
    }
    return { status: 'no_commit' }
  }
}

function parseArgs(): {
  rpcUrl: string
  packAddress: string
  fromBlock: number
  toBlock?: number
  logChunkSize?: number
  skipRevealEvents?: boolean
} {
  const args = process.argv.slice(2)
  let rpcUrl = ''
  let packAddress = ''
  let fromBlock: number | undefined
  let toBlock: number | undefined
  let logChunkSize: number | undefined
  let skipRevealEvents = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rpc-url' && i + 1 < args.length) {
      rpcUrl = args[i + 1]
      i++
    } else if (args[i] === '--pack-address' && i + 1 < args.length) {
      packAddress = args[i + 1]
      i++
    } else if (args[i] === '--from-block' && i + 1 < args.length) {
      fromBlock = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--to-block' && i + 1 < args.length) {
      toBlock = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--log-chunk-size' && i + 1 < args.length) {
      logChunkSize = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--skip-reveal-events') {
      skipRevealEvents = true
    }
  }

  if (!rpcUrl || !packAddress) {
    console.error(
      'Usage: pnpm ts-node scripts/pendingPackCommits.ts --rpc-url <url> --pack-address <addr> [--from-block <n>] [--to-block <n>] [--log-chunk-size <n>] [--skip-reveal-events]',
    )
    process.exit(1)
  }

  return {
    rpcUrl,
    packAddress: packAddress.toLowerCase(),
    fromBlock: fromBlock ?? 1,
    toBlock,
    logChunkSize,
    skipRevealEvents,
  }
}

async function main() {
  const {
    rpcUrl,
    packAddress,
    fromBlock,
    toBlock: toBlockArg,
    logChunkSize,
    skipRevealEvents,
  } = parseArgs()
  const toBlock = toBlockArg || (await getLatestBlock(rpcUrl))

  // If fromBlock is 1 (default), automatically find the deployment block
  let actualFromBlock = fromBlock ?? 1
  if (fromBlock === 1) {
    try {
      actualFromBlock = await findDeploymentBlock(rpcUrl, packAddress, toBlock)
      console.error('')
      console.error(
        `💡 Tip: For faster runs, use --from-block ${actualFromBlock} next time`,
      )
      console.error('')
    } catch (error: any) {
      console.error('')
      console.error(
        `⚠️  Warning: Could not find deployment block: ${error.message}`,
      )
      console.error('  Falling back to block 1')
      console.error('')
      actualFromBlock = 1
    }
  }

  const blockRange = toBlock - actualFromBlock
  if (blockRange > 100000) {
    console.error('')
    console.error(
      `⚠️  Warning: Large block range detected (${blockRange} blocks).`,
    )
    if (fromBlock === 1) {
      console.error(
        `  This may cause RPC timeouts. Consider using --from-block to limit the range.`,
      )
      console.error(
        `  Example: --from-block ${
          toBlock - 100000
        } to query only the last 100k blocks.`,
      )
    } else {
      console.error('  This may cause RPC timeouts.')
    }
    console.error('')
  }

  console.error(
    `📥 Fetching Commit events from block ${actualFromBlock} to ${toBlock}...`,
  )

  // Step 1: Get all Commit events
  const commitEvents = await getCommitEvents(
    rpcUrl,
    packAddress,
    actualFromBlock,
    toBlock,
    logChunkSize,
  )
  console.error(`  ✓ Found ${commitEvents.length} Commit events`)
  console.error('')

  // Log all commits grouped by address
  const commitsByAddress = new Map<string, CommitEvent[]>()
  for (const event of commitEvents) {
    if (!commitsByAddress.has(event.user)) {
      commitsByAddress.set(event.user, [])
    }
    commitsByAddress.get(event.user)!.push(event)
  }
  console.error('📋 Commits by address:')
  for (const [address, events] of commitsByAddress.entries()) {
    const packIds = events.map(e => e.packId).join(', ')
    const txHashes = events.map(e => e.transactionHash).join(', ')
    console.error(
      `  ${address}: ${events.length} commit(s) - packIds: ${packIds} - txHashes: ${txHashes}`,
    )
  }

  // Step 2: Deduplicate - keep only latest for each (user, packId) pair
  const latestCommits = new Map<string, CommitEvent>()
  for (const event of commitEvents) {
    const key = `${event.user}:${event.packId}`
    const existing = latestCommits.get(key)
    if (!existing || event.blockNumber > existing.blockNumber) {
      latestCommits.set(key, event)
    }
  }
  console.error(
    `\n🔄 After deduplication: ${latestCommits.size} unique commits`,
  )

  // Log deduplicated commits
  const latestCommitsByAddress = new Map<string, CommitEvent[]>()
  for (const event of latestCommits.values()) {
    if (!latestCommitsByAddress.has(event.user)) {
      latestCommitsByAddress.set(event.user, [])
    }
    latestCommitsByAddress.get(event.user)!.push(event)
  }
  console.error('📋 Commits to check by address:')
  for (const [address, events] of latestCommitsByAddress.entries()) {
    const packIds = events.map(e => e.packId).join(', ')
    const txHashes = events.map(e => e.transactionHash).join(', ')
    console.error(
      `  ${address}: ${events.length} commit(s) - packIds: ${packIds} - txHashes: ${txHashes}`,
    )
  }

  // Step 3: Filter out revealed commits and check status
  const pendingCommits: PendingCommit[] = []
  const refundEligible: Array<{
    user: string
    packId: string
    commitVersion: 'v0' | 'v1'
    commitTransactionHash: string
    commitBlockNumber: number
  }> = []
  const revealedCommits: CommitEvent[] = []

  if (skipRevealEvents) {
    // Path: Use getRevealIdx to determine status directly
    console.error(
      '\n🔍 Checking commitment status for each commit using getRevealIdx...',
    )

    let checkedCount = 0
    const commitsToCheck = Array.from(latestCommits.values())
    for (const commit of commitsToCheck) {
      checkedCount++
      console.error(
        `  [${checkedCount}/${commitsToCheck.length}] Checking ${commit.user} packId ${commit.packId}...`,
      )

      const status = await checkCommitmentStatus(
        rpcUrl,
        packAddress,
        commit.user,
        commit.packId,
      )

      // Since we're checking commits from Commit events, if getRevealIdx returns
      // NoCommit(), it means the commitment was revealed (deleted), not that it never existed.

      if (status.status === 'pending_reveal') {
        console.error(`    ✓ Pending reveal (revealIdx: ${status.revealIdx})`)
        // Determine version by checking storage (we still need this for output)
        const commitmentsSlot = 15
        const { version } = await checkCommitmentPending(
          rpcUrl,
          packAddress,
          commit.user,
          commit.packId,
          commitmentsSlot,
        )
        pendingCommits.push({
          user: commit.user,
          packId: commit.packId,
          commitVersion: version || 'v1', // Default to v1 if version detection fails
          commitTransactionHash: commit.transactionHash,
          commitBlockNumber: commit.blockNumber,
          revealIdx: status.revealIdx,
        })
      } else if (status.status === 'expired_refund') {
        console.error(`    ✗ Expired (ready for refund)`)
        const commitmentsSlot = 15
        const { version } = await checkCommitmentPending(
          rpcUrl,
          packAddress,
          commit.user,
          commit.packId,
          commitmentsSlot,
        )
        refundEligible.push({
          user: commit.user,
          packId: commit.packId,
          commitVersion: version || 'v1',
          commitTransactionHash: commit.transactionHash,
          commitBlockNumber: commit.blockNumber,
        })
      } else {
        // status.status === 'revealed' || status.status === 'no_commit'
        // Both mean the commitment doesn't exist. Since we're checking commits from events,
        // this means it was revealed.
        console.error(`    ✓ Already revealed (commitment deleted)`)
        revealedCommits.push(commit)
      }
    }
  } else {
    // Path: Fetch Reveal events and filter
    // Find the earliest commit block number to use as from-block for reveals
    let earliestCommitBlock = actualFromBlock
    if (commitEvents.length > 0) {
      const validBlockNumbers = commitEvents
        .map(e => e.blockNumber)
        .filter(bn => !isNaN(bn) && bn > 0)
      if (validBlockNumbers.length > 0) {
        earliestCommitBlock = Math.min(...validBlockNumbers)
      }
    }

    console.error('\n📥 Fetching Reveal events...')
    let revealEvents: RevealEvent[] = []
    try {
      revealEvents = await getRevealEvents(
        rpcUrl,
        packAddress,
        earliestCommitBlock,
        toBlock,
        logChunkSize,
      )
      console.error(`  ✓ Found ${revealEvents.length} Reveal events`)
    } catch (error: any) {
      if (
        error.message?.includes('RPC_ERROR') ||
        error.message?.includes('HTTP error 500') ||
        error.message?.includes('origin request failed')
      ) {
        console.error('')
        console.error(
          `⚠️  Error fetching Reveal events: RPC endpoint returned an error.`,
        )
        console.error(
          `  This is likely due to the large block range (${blockRange} blocks).`,
        )
        console.error(
          `  💡 Tip: Use --skip-reveal-events to use a different approach!`,
        )
        console.error('  Continuing without Reveal events...')
        console.error('')
        revealEvents = []
      } else {
        throw error
      }
    }

    // Filter out commits that were revealed
    const unrevealedCommits: CommitEvent[] = []
    for (const commit of latestCommits.values()) {
      const revealAfterCommit = revealEvents.some(
        r =>
          r.user.toLowerCase() === commit.user &&
          r.packId === commit.packId &&
          r.blockNumber > commit.blockNumber,
      )
      if (!revealAfterCommit) {
        unrevealedCommits.push(commit)
      } else {
        revealedCommits.push(commit)
      }
    }
    console.error('')
    console.error(
      `🔄 After filtering reveals: ${unrevealedCommits.length} unrevealed commits, ${revealedCommits.length} revealed commits`,
    )

    // Check storage slots and getRevealIdx for unrevealed commits
    const commitmentsSlot = 15
    console.error('\n🔍 Checking storage slots and reveal availability...')
    let checkedCount = 0
    for (const commit of unrevealedCommits) {
      checkedCount++
      console.error(
        `  [${checkedCount}/${unrevealedCommits.length}] Checking ${commit.user} packId ${commit.packId}...`,
      )
      const { pending, version } = await checkCommitmentPending(
        rpcUrl,
        packAddress,
        commit.user,
        commit.packId,
        commitmentsSlot,
      )

      if (pending && version) {
        console.error(`    ✓ Commit pending (version: ${version})`)
        const status = await checkCommitmentStatus(
          rpcUrl,
          packAddress,
          commit.user,
          commit.packId,
        )

        if (status.status === 'pending_reveal') {
          console.error(
            `    ✓ Reveal available (revealIdx: ${status.revealIdx})`,
          )
          pendingCommits.push({
            user: commit.user,
            packId: commit.packId,
            commitVersion: version,
            commitTransactionHash: commit.transactionHash,
            commitBlockNumber: commit.blockNumber,
            revealIdx: status.revealIdx,
          })
        } else {
          console.error(`    ✗ Reveal not available (ready for refund)`)
          refundEligible.push({
            user: commit.user,
            packId: commit.packId,
            commitVersion: version,
            commitTransactionHash: commit.transactionHash,
            commitBlockNumber: commit.blockNumber,
          })
        }
      } else {
        console.error(`    ✗ No pending commit found`)
      }
    }
  }

  // Log revealed commits
  if (revealedCommits.length > 0) {
    const revealedByAddress = new Map<string, CommitEvent[]>()
    for (const commit of revealedCommits) {
      if (!revealedByAddress.has(commit.user)) {
        revealedByAddress.set(commit.user, [])
      }
      revealedByAddress.get(commit.user)!.push(commit)
    }
    console.error('\n✅ Revealed commits by address:')
    for (const [address, events] of revealedByAddress.entries()) {
      const packIds = events.map(e => e.packId).join(', ')
      const txHashes = events.map(e => e.transactionHash).join(', ')
      console.error(
        `  ${address}: ${events.length} commit(s) - packIds: ${packIds} - txHashes: ${txHashes}`,
      )
    }
  }

  console.error('')
  console.error(
    `✅ Found ${pendingCommits.length} pending commits ready for reveal`,
  )
  console.error(`💰 Found ${refundEligible.length} commits ready for refund`)

  // Find earliest unrevealed commit block number and transaction hash
  let earliestUnrevealedBlock: number | null = null
  let earliestUnrevealedTxHash: string | null = null
  const allUnrevealed = [...pendingCommits, ...refundEligible]
  if (allUnrevealed.length > 0) {
    const sortedCommits = allUnrevealed.sort(
      (a, b) => a.commitBlockNumber - b.commitBlockNumber,
    )
    earliestUnrevealedBlock = sortedCommits[0].commitBlockNumber
    earliestUnrevealedTxHash = sortedCommits[0].commitTransactionHash
  }

  // Step 6: Output results
  const output = {
    pendingReveals: pendingCommits,
    refundEligible: refundEligible,
  }
  console.log(JSON.stringify(output, null, 2))

  // Output tip for next run
  if (
    earliestUnrevealedBlock !== null &&
    earliestUnrevealedTxHash &&
    earliestUnrevealedBlock !== actualFromBlock
  ) {
    console.error('')
    console.error(
      `💡 Tip: Use --from-block ${earliestUnrevealedBlock} for faster future runs`,
    )
  } else if (
    pendingCommits.length === 0 &&
    refundEligible.length === 0 &&
    toBlock !== actualFromBlock
  ) {
    // If no pending reveals or refunds, suggest using current block
    console.error('')
    console.error(`💡 Tip: Use --from-block ${toBlock} for faster future runs`)
  }
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
