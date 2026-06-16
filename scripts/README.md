# Scripts

## generateMerkleTree.ts

Utilities for generating Merkle trees and proofs. Exports:

- `generateTree(elements: TreeElement[])` - Creates a Merkle tree from address/tokenId pairs
- `generateProof(tree: MerkleTree, element: TreeElement)` - Generates a proof for a given element
- `getLeaf(element: TreeElement)` - Gets the leaf hash for an element

## outputSelectors.ts

Outputs method selectors for proxied token contracts using `forge inspect`.

**Usage:**

```bash
pnpm ts-node scripts/outputSelectors.ts
```

This script iterates through `PROXIED_TOKEN_CONTRACT_NAMES` and outputs each contract's method selectors in a format suitable for selector collision checking.

## pendingPackCommits.ts

Finds pending pack commits that haven't been revealed yet, checking both v0 and v1 commitment storage layouts.

**Usage:**

```bash
pnpm ts-node scripts/pendingPackCommits.ts --rpc-url <url> --pack-address <addr> [--from-block <n>] [--to-block <n>] [--log-chunk-size <n>] [--skip-reveal-events]
```

Use `--log-chunk-size 100` and `--skip-reveal-events` for chains that do not support event retrieval over large block ranges (e.g. Etherlink).

Outputs JSON with `pendingReveals` and `refundEligible` arrays containing commit details.
