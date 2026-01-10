// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.19;

import {ERC721Sale} from "@0xsequence/contracts-library/tokens/ERC721/utility/sale/ERC721Sale.sol";
import {
    IERC721SaleFactory,
    IERC721SaleFactoryFunctions
} from "@0xsequence/contracts-library/tokens/ERC721/utility/sale/IERC721SaleFactory.sol";
import {SequenceProxyFactory} from "@0xsequence/contracts-library/proxies/SequenceProxyFactory.sol";

/**
 * Deployer of ERC-721 Sale proxies.
 */
contract ERC721SaleFactory is IERC721SaleFactory, SequenceProxyFactory {
    /**
     * Creates an ERC-721 Sale Factory.
     * @param factoryOwner The owner of the ERC-721 Sale Factory
     */
    constructor(address factoryOwner) {
        ERC721Sale impl = new ERC721Sale();
        SequenceProxyFactory._initialize(address(impl), factoryOwner);
    }

    /// @inheritdoc IERC721SaleFactoryFunctions
<<<<<<< Updated upstream
    function deploy(
        address proxyOwner,
        address tokenOwner,
        address items,
        address implicitModeValidator,
        bytes32 implicitModeProjectId
    ) external returns (address proxyAddr) {
        bytes32 salt = keccak256(abi.encode(tokenOwner, items, implicitModeValidator, implicitModeProjectId));
=======
    function deploy(address proxyOwner, address tokenOwner, address items) external returns (address proxyAddr) {
        bytes32 salt = keccak256(abi.encode(tokenOwner, items));
>>>>>>> Stashed changes
        proxyAddr = _createProxy(salt, proxyOwner, "");
        ERC721Sale(proxyAddr).initialize(tokenOwner, items);
        emit ERC721SaleDeployed(proxyAddr);
        return proxyAddr;
    }

    /// @inheritdoc IERC721SaleFactoryFunctions
<<<<<<< Updated upstream
    function determineAddress(
        address proxyOwner,
        address tokenOwner,
        address items,
        address implicitModeValidator,
        bytes32 implicitModeProjectId
    ) external view returns (address proxyAddr) {
        bytes32 salt = keccak256(abi.encode(tokenOwner, items, implicitModeValidator, implicitModeProjectId));
=======
    function determineAddress(address proxyOwner, address tokenOwner, address items)
        external
        view
        returns (address proxyAddr)
    {
        bytes32 salt = keccak256(abi.encode(tokenOwner, items));
>>>>>>> Stashed changes
        return _computeProxyAddress(salt, proxyOwner, "");
    }
}
