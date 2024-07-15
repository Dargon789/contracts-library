// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.19;

import {IPayments, IPaymentsFunctions} from "./IPayments.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@0xsequence/erc-1155/contracts/interfaces/IERC165.sol";

import {IERC721Transfer} from "../tokens/common/IERC721Transfer.sol";
import {IERC1155} from "@0xsequence/erc-1155/contracts/interfaces/IERC1155.sol";

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";

contract Payments is Ownable, IPayments, IERC165 {
    using ECDSA for bytes32;

    address public signer;

    // Payment accepted. Works as a nonce.
    mapping(uint256 => bool) public paymentAccepted;

    constructor(address _owner, address _signer) {
        Ownable._transferOwnership(_owner);
        signer = _signer;
    }

    /**
     * Update the signer address.
     */
    function updateSigner(address newSigner) external onlyOwner {
        signer = newSigner;
    }

    /// @inheritdoc IPaymentsFunctions
    function makePayment(PaymentDetails calldata paymentDetails, bytes calldata signature) external payable {
        // Check if payment is already accepted
        if (paymentAccepted[paymentDetails.purchaseId]) {
            revert PaymentAlreadyAccepted();
        }
        if (!isValidSignature(paymentDetails, signature)) {
            revert InvalidSignature();
        }
        if (block.timestamp > paymentDetails.expiration) {
            revert PaymentExpired();
        }
        paymentAccepted[paymentDetails.purchaseId] = true;

        address spender = msg.sender;

        for (uint256 i = 0; i < paymentDetails.paymentRecipients.length; i++) {
            // We don't check length == 0. Will only be signed if length 0 is a valid input.
            PaymentRecipient calldata recipient = paymentDetails.paymentRecipients[i];
            _takePayment(
                paymentDetails.tokenType,
                paymentDetails.tokenAddress,
                spender,
                recipient.recipient,
                paymentDetails.tokenId,
                recipient.amount
            );
        }

        // Emit event
        emit PaymentMade(spender, paymentDetails.productRecipient, paymentDetails.purchaseId, paymentDetails.productId);

        // Perform chained call
        if (paymentDetails.chainedCallAddress != address(0)) {
            _performChainedCall(paymentDetails.chainedCallAddress, paymentDetails.chainedCallData);
        }
    }

    /// @inheritdoc IPaymentsFunctions
    /// @notice A valid signature does not guarantee that the payment will be accepted.
    function isValidSignature(PaymentDetails calldata paymentDetails, bytes calldata signature)
        public
        view
        returns (bool)
    {
        bytes32 messageHash = hashPaymentDetails(paymentDetails);
        address sigSigner = messageHash.recoverCalldata(signature);
        return sigSigner == signer;
    }

    /// @inheritdoc IPaymentsFunctions
    /// @dev This hash includes the chain ID.
    function hashPaymentDetails(PaymentDetails calldata paymentDetails) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                paymentDetails.purchaseId,
                paymentDetails.productRecipient,
                paymentDetails.tokenType,
                paymentDetails.tokenAddress,
                paymentDetails.tokenId,
                paymentDetails.paymentRecipients,
                paymentDetails.expiration,
                paymentDetails.productId,
                paymentDetails.chainedCallAddress,
                paymentDetails.chainedCallData
            )
        );
    }

    /// @inheritdoc IPaymentsFunctions
    /// @notice This can only be called by the signer.
    /// @dev As the signer can validate any payment (including zero) this function does not increase the security surface.
    function performChainedCall(address chainedCallAddress, bytes calldata chainedCallData) external override {
        // Check authorization
        if (msg.sender != signer) {
            revert InvalidSender();
        }
        _performChainedCall(chainedCallAddress, chainedCallData);
    }

    /**
     * Perform a chained call and revert on error.
     */
    function _performChainedCall(address chainedCallAddress, bytes calldata chainedCallData) internal {
        (bool success, ) = chainedCallAddress.call{value: 0}(chainedCallData);
        if (!success) {
            revert ChainedCallFailed();
        }
    }

    /**
     * Take payment in the given token.
     */
    function _takePayment(
        TokenType tokenType,
        address tokenAddr,
        address from,
        address to,
        uint256 tokenId,
        uint256 amount
    ) internal {
        if (tokenType == TokenType.ERC1155) {
            // ERC-1155
            IERC1155(tokenAddr).safeTransferFrom(from, to, tokenId, amount, "");
        } else if (tokenType == TokenType.ERC721) {
            // ERC-721
            if (amount > 1) {
                revert InvalidTokenTransfer();
            }
            IERC721Transfer(tokenAddr).safeTransferFrom(from, to, tokenId);
        } else if (tokenType == TokenType.ERC20) {
            // ERC-20
            if (tokenId != 0) {
                revert InvalidTokenTransfer();
            }
            SafeTransferLib.safeTransferFrom(tokenAddr, from, to, amount);
        } else {
            revert InvalidTokenTransfer();
        }
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 _interfaceID) public view virtual returns (bool) {
        return _interfaceID == type(IPayments).interfaceId || _interfaceID == type(IPaymentsFunctions).interfaceId
            || _interfaceID == type(IERC165).interfaceId;
    }
}
