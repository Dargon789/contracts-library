# Payments

This subsection of the repository contains the implementation of payment related contracts.

## Features

### Payment Combiner

A factory for deploying Payment Splitter clones. The Combiner records every splitter a payee is associated with, so a payee can list pending shares and release them across many splitters in a single call.

Payment Splitters should be deployed by the Combiner rather than constructed directly. This registers the payees and enables the Combiner's listing and batch-release helpers.

**Note**: Unlike other factories in this library, payment splitters are unowned and not upgradeable.

The Combiner provides the following functions:

* `deploy(address[] payees, uint256[] shares)`: Deploys a Payment Splitter clone for the given payees and share amounts.
* `determineAddress(address[] payees, uint256[] shares)`: Computes the address of a splitter before it is deployed.
* `countPayeeSplitters(address payee)` / `listPayeeSplitters(address payee, uint256 offset, uint256 limit)`: Returns the splitters associated with a payee.
* `listReleasable(address payee, address tokenAddr, address[] splitterAddrs)`: Returns pending shares for a payee. Use `tokenAddr` `address(0)` for the native token, otherwise an ERC-20. An empty `splitterAddrs` array uses all splitters for that payee.
* `release(address payable payee, address tokenAddr, address[] splitterAddrs)`: Releases pending shares to a payee from the given splitters. An empty `splitterAddrs` array uses all splitters for that payee.

`listReleasable` includes zero balances. These should be removed before calling `release`, as releasing from a splitter with no pending shares will fail.

### Payment Splitter

A pull-based splitter for native tokens and ERC-20 payments among a fixed set of payees. Each payee is assigned a number of shares; released amounts are proportional to those shares.

This contract is a thin wrapper around OpenZeppelin's [PaymentSplitter](https://docs.openzeppelin.com/contracts/4.x/api/finance#PaymentSplitter). It is initialized by the Combiner immediately after clone deployment.

> [!WARNING]
> The OpenZeppelin's PaymentSplitter has known issues with chains that support dual interface tokens (e.g. USDC on Arc).

### Payments Factory

A factory for deploying Payments proxies. This follows the same Sequence Proxy Factory pattern as other factories in this library: a single factory deployment, then subsequent Payments instances at minimal gas cost.

Payments contracts should be deployed by the factory rather than constructed directly.

### Payments

A contract for collecting signed payments for a product. A designated signer authorizes payment details off chain; the payer then submits those details on chain. This allows a backend to price and route payments without holding funds.

The contract owner may update the signer. Each `purchaseId` may be accepted only once, which prevents double spending. Payments expire after the timestamp in the signed details.

Supported payment tokens are ERC-20, ERC-721, and ERC-1155. A single payment may send funds to multiple recipients. After the transfers succeed, an optional chained call may be executed (for example, to mint a token). When payment is accepted off chain or on another chain, `performChainedCall` can run that call on its own, using a signature from the same signer.

Payment and chained-call hashes include the chain ID.

## Usage

### Payment Combiner

1. Deploy the `PaymentCombiner` contract (or use an existing deployment).
2. Call `deploy` with the payees and their shares. A Payment Splitter clone will be created and initialized.
3. Send native tokens or ERC-20 tokens to the splitter address.
4. Payees call `release` on the Combiner (or on an individual splitter) to pull their share.

```solidity
import {PaymentCombiner} from "./payments/PaymentCombiner.sol";

contract MyRevenueShare {
    PaymentCombiner public immutable combiner;

    constructor(PaymentCombiner _combiner) {
        combiner = _combiner;
    }

    function createSplitter(address[] calldata payees, uint256[] calldata shares) external returns (address) {
        return combiner.deploy(payees, shares);
    }
}
```

### Payments

This section of this repo utilizes a factory pattern that deploys proxy contracts. This allows for a single deployment of each `Factory` contract, and subsequent deployments of the contracts with minimal gas costs.

1. Deploy the `PaymentsFactory` contract (or use an existing deployment).
2. Call the `deploy` function on the factory, providing the proxy owner, payments owner, and payments signer.
3. A new Payments contract will be created and initialized, ready for use.

```solidity
import {PaymentsFactory} from "./payments/PaymentsFactory.sol";

contract MyCheckout {
    PaymentsFactory public immutable factory;

    constructor(PaymentsFactory _factory) {
        factory = _factory;
    }

    function createPayments(address proxyOwner, address paymentsOwner, address paymentsSigner) external returns (address) {
        return factory.deploy(proxyOwner, paymentsOwner, paymentsSigner);
    }
}
```
