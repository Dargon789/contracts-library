// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.19;

<<<<<<< Updated upstream
import { MerkleProofSingleUse } from "../../../common/MerkleProofSingleUse.sol";
import { SignalsImplicitModeControlled } from "../../../common/SignalsImplicitModeControlled.sol";
import { AccessControlEnumerable, IERC20, SafeERC20, WithdrawControlled } from "../../../common/WithdrawControlled.sol";
import { IERC1155ItemsFunctions } from "../../presets/items/IERC1155Items.sol";
import { IERC1155Sale } from "./IERC1155Sale.sol";
=======
import {
    IERC1155Sale,
    IERC1155SaleFunctions
} from "@0xsequence/contracts-library/tokens/ERC1155/utility/sale/IERC1155Sale.sol";
import {ERC1155Supply} from "@0xsequence/contracts-library/tokens/ERC1155/extensions/supply/ERC1155Supply.sol";
import {
    WithdrawControlled,
    AccessControlEnumerable,
    SafeERC20,
    IERC20
} from "@0xsequence/contracts-library/tokens/common/WithdrawControlled.sol";
import {MerkleProofSingleUse} from "@0xsequence/contracts-library/tokens/common/MerkleProofSingleUse.sol";
>>>>>>> Stashed changes

import {IERC1155} from "@0xsequence/erc-1155/contracts/interfaces/IERC1155.sol";
import {IERC1155SupplyFunctions} from
    "@0xsequence/contracts-library/tokens/ERC1155/extensions/supply/IERC1155Supply.sol";
import {IERC1155ItemsFunctions} from "@0xsequence/contracts-library/tokens/ERC1155/presets/items/IERC1155Items.sol";

contract ERC1155Sale is IERC1155Sale, WithdrawControlled, MerkleProofSingleUse {
    bytes32 internal constant MINT_ADMIN_ROLE = keccak256("MINT_ADMIN_ROLE");

    bool private _initialized;
    address private _items;

<<<<<<< Updated upstream
    // Sales details indexed by sale index.
    SaleDetails[] private _saleDetails;
    // tokenId => saleIndex => quantity minted
    mapping(uint256 => mapping(uint256 => uint256)) private _tokensMintedPerSale;
=======
    // ERC20 token address for payment. address(0) indicated payment in ETH.
    address private _paymentToken;

    SaleDetails private _globalSaleDetails;
    mapping(uint256 => SaleDetails) private _tokenSaleDetails;
>>>>>>> Stashed changes

    /**
     * Initialize the contract.
     * @param owner Owner address
     * @param items The ERC-1155 Items contract address
     * @dev This should be called immediately after deployment.
     */
    function initialize(address owner, address items) public virtual {
        if (_initialized) {
            revert InvalidInitialization();
        }

        _items = items;

        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(MINT_ADMIN_ROLE, owner);
        _grantRole(WITHDRAW_ROLE, owner);

        _initialized = true;
    }

    /**
<<<<<<< Updated upstream
     * Checks the sale is active, valid and takes payment.
=======
     * Checks if the current block.timestamp is out of the give timestamp range.
     * @param _startTime Earliest acceptable timestamp (inclusive).
     * @param _endTime Latest acceptable timestamp (exclusive).
     * @dev A zero endTime value is always considered out of bounds.
     */
    function _blockTimeOutOfBounds(uint256 _startTime, uint256 _endTime) private view returns (bool) {
        // 0 end time indicates inactive sale.
        return _endTime == 0 || block.timestamp < _startTime || block.timestamp >= _endTime; // solhint-disable-line not-rely-on-time
    }

    /**
     * Checks the sale is active and takes payment.
>>>>>>> Stashed changes
     * @param _tokenIds Token IDs to mint.
     * @param _amounts Amounts of tokens to mint.
     * @param _saleIndexes Sale indexes for each token.
     * @param _expectedPaymentToken ERC20 token address to accept payment in. address(0) indicates ETH.
     * @param _maxTotal Maximum amount of payment tokens.
     * @param _proofs Merkle proofs for allowlist minting.
     */
<<<<<<< Updated upstream
    function _validateMint(
        uint256[] calldata _tokenIds,
        uint256[] calldata _amounts,
        uint256[] calldata _saleIndexes,
=======
    function _payForActiveMint(
        uint256[] memory _tokenIds,
        uint256[] memory _amounts,
>>>>>>> Stashed changes
        address _expectedPaymentToken,
        uint256 _maxTotal,
        bytes32[][] calldata _proofs
    ) private {
        uint256 totalCost;

<<<<<<< Updated upstream
        // Validate input arrays have matching lengths
        uint256 length = _tokenIds.length;
        if (length != _amounts.length || length != _saleIndexes.length || length != _proofs.length) {
            revert InvalidArrayLengths();
        }

        for (uint256 i; i < length; i++) {
=======
        SaleDetails memory gSaleDetails = _globalSaleDetails;
        bool globalSaleInactive = _blockTimeOutOfBounds(gSaleDetails.startTime, gSaleDetails.endTime);
        bool globalMerkleCheckRequired = false;
        for (uint256 i; i < _tokenIds.length; i++) {
>>>>>>> Stashed changes
            uint256 tokenId = _tokenIds[i];
            uint256 saleIndex = _saleIndexes[i];

            // Find the sale details for the token
            if (saleIndex >= _saleDetails.length) {
                revert SaleDetailsNotFound(saleIndex);
            }
            SaleDetails memory details = _saleDetails[saleIndex];

            // Check if token is within the sale range
            if (tokenId < details.minTokenId || tokenId > details.maxTokenId) {
                revert InvalidSaleDetails();
            }

            // Check if sale is active
            // solhint-disable-next-line not-rely-on-time
            if (block.timestamp < details.startTime || block.timestamp > details.endTime) {
                revert SaleInactive();
            }

            // Validate payment token matches expected
            if (details.paymentToken != _expectedPaymentToken) {
                revert PaymentTokenMismatch();
            }

            uint256 amount = _amounts[i];
<<<<<<< Updated upstream
            if (amount == 0) {
                revert InvalidAmount();
=======

            // Active sale test
            SaleDetails memory saleDetails = _tokenSaleDetails[tokenId];
            bool tokenSaleInactive = _blockTimeOutOfBounds(saleDetails.startTime, saleDetails.endTime);
            if (tokenSaleInactive) {
                // Prefer token sale
                if (globalSaleInactive) {
                    // Both sales inactive
                    revert SaleInactive(tokenId);
                }
                // Use global sale details
                globalMerkleCheckRequired = true;
                totalCost += gSaleDetails.cost * amount;
            } else {
                // Use token sale details
                requireMerkleProof(saleDetails.merkleRoot, _proof, msg.sender, bytes32(tokenId));
                totalCost += saleDetails.cost * amount;
>>>>>>> Stashed changes
            }

            // Check supply
            uint256 minted = _tokensMintedPerSale[tokenId][saleIndex];
            if (amount > details.supply - minted) {
                revert InsufficientSupply(details.supply - minted, amount);
            }

            // Check merkle proof
            requireMerkleProof(details.merkleRoot, _proofs[i], msg.sender, bytes32(tokenId));

            // Update supply and calculate cost
            _tokensMintedPerSale[tokenId][saleIndex] = minted + amount;
            totalCost += details.cost * amount;
        }

        if (_maxTotal < totalCost) {
            // Caller expected to pay less
            revert InsufficientPayment(_expectedPaymentToken, totalCost, _maxTotal);
        }
        if (_expectedPaymentToken == address(0)) {
            // Paid in ETH
            if (msg.value != totalCost) {
                // We expect exact value match
                revert InsufficientPayment(_expectedPaymentToken, totalCost, msg.value);
            }
        } else if (msg.value > 0) {
            // Paid in ERC20, but sent ETH
            revert InsufficientPayment(address(0), 0, msg.value);
        } else {
            // Paid in ERC20
            SafeERC20.safeTransferFrom(IERC20(_expectedPaymentToken), msg.sender, address(this), totalCost);
        }
    }

    //
    // Minting
    //

    /// @inheritdoc IERC1155Sale
    /// @notice Sale must be active for all tokens.
    /// @dev All sales must use the same payment token.
    /// @dev An empty proof is supplied when no proof is required.
    function mint(
        address to,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts,
        bytes calldata data,
        uint256[] calldata saleIndexes,
        address expectedPaymentToken,
        uint256 maxTotal,
        bytes32[][] calldata proofs
    ) public payable {
<<<<<<< Updated upstream
        _validateMint(tokenIds, amounts, saleIndexes, expectedPaymentToken, maxTotal, proofs);
        IERC1155ItemsFunctions(_items).batchMint(to, tokenIds, amounts, data);
        emit ItemsMinted(to, tokenIds, amounts, saleIndexes);
=======
        _payForActiveMint(tokenIds, amounts, expectedPaymentToken, maxTotal, proof);

        IERC1155SupplyFunctions items = IERC1155SupplyFunctions(_items);
        uint256 totalAmount = 0;
        uint256 nMint = tokenIds.length;
        for (uint256 i = 0; i < nMint; i++) {
            // Update storage balance
            uint256 tokenSupplyCap = _tokenSaleDetails[tokenIds[i]].supplyCap;
            if (tokenSupplyCap > 0 && items.tokenSupply(tokenIds[i]) + amounts[i] > tokenSupplyCap) {
                revert InsufficientSupply(items.tokenSupply(tokenIds[i]), amounts[i], tokenSupplyCap);
            }
            totalAmount += amounts[i];
        }
        uint256 totalSupplyCap = _globalSaleDetails.supplyCap;
        if (totalSupplyCap > 0 && items.totalSupply() + totalAmount > totalSupplyCap) {
            revert InsufficientSupply(items.totalSupply(), totalAmount, totalSupplyCap);
        }

        IERC1155ItemsFunctions(_items).batchMint(to, tokenIds, amounts, data);
>>>>>>> Stashed changes
    }

    //
    // Admin
    //

<<<<<<< Updated upstream
    /// @inheritdoc IERC1155Sale
    function addSaleDetails(
        SaleDetails calldata details
    ) public onlyRole(MINT_ADMIN_ROLE) returns (uint256 saleIndex) {
        _validateSaleDetails(details);

        saleIndex = _saleDetails.length;
        _saleDetails.push(details);

        emit SaleDetailsAdded(saleIndex, details);
    }

    /// @inheritdoc IERC1155Sale
    function updateSaleDetails(uint256 saleIndex, SaleDetails calldata details) public onlyRole(MINT_ADMIN_ROLE) {
        if (saleIndex >= _saleDetails.length) {
            revert SaleDetailsNotFound(saleIndex);
        }
        _validateSaleDetails(details);

        _saleDetails[saleIndex] = details;

        emit SaleDetailsUpdated(saleIndex, details);
    }

    function _validateSaleDetails(
        SaleDetails calldata details
    ) private pure {
        if (details.maxTokenId < details.minTokenId) {
            revert InvalidSaleDetails();
        }
        if (details.supply == 0) {
            revert InvalidSaleDetails();
        }
        if (details.endTime < details.startTime) {
            revert InvalidSaleDetails();
        }
=======
    /**
     * Set the payment token.
     * @param paymentTokenAddr The ERC20 token address to accept payment in. address(0) indicates ETH.
     * @dev This should be set before the sale starts.
     */
    function setPaymentToken(address paymentTokenAddr) public onlyRole(MINT_ADMIN_ROLE) {
        _paymentToken = paymentTokenAddr;
    }

    /**
     * Set the global sale details.
     * @param cost The amount of payment tokens to accept for each token minted.
     * @param supplyCap The maximum number of tokens that can be minted.
     * @param startTime The start time of the sale. Tokens cannot be minted before this time.
     * @param endTime The end time of the sale. Tokens cannot be minted after this time.
     * @param merkleRoot The merkle root for allowlist minting.
     * @dev A zero end time indicates an inactive sale.
     * @notice The payment token is set globally.
     */
    function setGlobalSaleDetails(uint256 cost, uint256 supplyCap, uint64 startTime, uint64 endTime, bytes32 merkleRoot)
        public
        onlyRole(MINT_ADMIN_ROLE)
    {
        // solhint-disable-next-line not-rely-on-time
        if (endTime < startTime || endTime <= block.timestamp) {
            revert InvalidSaleDetails();
        }
        _globalSaleDetails = SaleDetails(cost, supplyCap, startTime, endTime, merkleRoot);
        emit GlobalSaleDetailsUpdated(cost, supplyCap, startTime, endTime, merkleRoot);
    }

    /**
     * Set the sale details for an individual token.
     * @param tokenId The token ID to set the sale details for.
     * @param cost The amount of payment tokens to accept for each token minted.
     * @param supplyCap The maximum number of tokens that can be minted.
     * @param startTime The start time of the sale. Tokens cannot be minted before this time.
     * @param endTime The end time of the sale. Tokens cannot be minted after this time.
     * @param merkleRoot The merkle root for allowlist minting.
     * @dev A zero end time indicates an inactive sale.
     * @notice The payment token is set globally.
     */
    function setTokenSaleDetails(
        uint256 tokenId,
        uint256 cost,
        uint256 supplyCap,
        uint64 startTime,
        uint64 endTime,
        bytes32 merkleRoot
    ) public onlyRole(MINT_ADMIN_ROLE) {
        // solhint-disable-next-line not-rely-on-time
        if (endTime < startTime || endTime <= block.timestamp) {
            revert InvalidSaleDetails();
        }
        _tokenSaleDetails[tokenId] = SaleDetails(cost, supplyCap, startTime, endTime, merkleRoot);
        emit TokenSaleDetailsUpdated(tokenId, cost, supplyCap, startTime, endTime, merkleRoot);
>>>>>>> Stashed changes
    }

    //
    // Views
    //

<<<<<<< Updated upstream
    /// @inheritdoc IERC1155Sale
    function saleDetailsCount() external view returns (uint256) {
        return _saleDetails.length;
    }

    /// @inheritdoc IERC1155Sale
    function saleDetails(
        uint256 saleIndex
    ) external view returns (SaleDetails memory) {
        if (saleIndex >= _saleDetails.length) {
            revert SaleDetailsNotFound(saleIndex);
        }
        return _saleDetails[saleIndex];
    }

    /// @inheritdoc IERC1155Sale
    function saleDetailsBatch(
        uint256[] calldata saleIndexes
    ) external view returns (SaleDetails[] memory) {
        SaleDetails[] memory details = new SaleDetails[](saleIndexes.length);
        for (uint256 i = 0; i < saleIndexes.length; i++) {
            if (saleIndexes[i] >= _saleDetails.length) {
                revert SaleDetailsNotFound(saleIndexes[i]);
            }
            details[i] = _saleDetails[saleIndexes[i]];
        }
        return details;
=======
    /**
     * Get global sales details.
     * @return Sale details.
     * @notice Global sales details apply to all tokens.
     * @notice Global sales details are overriden when token sale is active.
     */
    function globalSaleDetails() external view returns (SaleDetails memory) {
        return _globalSaleDetails;
    }

    /**
     * Get token sale details.
     * @param tokenId Token ID to get sale details for.
     * @return Sale details.
     * @notice Token sale details override global sale details.
     */
    function tokenSaleDetails(uint256 tokenId) external view returns (SaleDetails memory) {
        return _tokenSaleDetails[tokenId];
    }

    /**
     * Get payment token.
     * @return Payment token address.
     * @notice address(0) indicates payment in ETH.
     */
    function paymentToken() external view returns (address) {
        return _paymentToken;
>>>>>>> Stashed changes
    }

    /**
     * Check interface support.
     * @param interfaceId Interface id
     * @return True if supported
     */
<<<<<<< Updated upstream
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(WithdrawControlled, SignalsImplicitModeControlled) returns (bool) {
        return type(IERC1155Sale).interfaceId == interfaceId || WithdrawControlled.supportsInterface(interfaceId)
            || SignalsImplicitModeControlled.supportsInterface(interfaceId);
=======
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlEnumerable)
        returns (bool)
    {
        return type(IERC1155SaleFunctions).interfaceId == interfaceId || super.supportsInterface(interfaceId);
>>>>>>> Stashed changes
    }
}
