// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.17;

interface IERC1155TokenFactory {
    /**
     * Event emitted when a new ERC-1155 Token proxy contract is deployed.
     * @param proxyAddr The address of the deployed proxy.
     */
    event ERC1155TokenDeployed(address proxyAddr);

    /**
     * Creates an ERC-1155 Token proxy.
     * @param owner The owner of the ERC-1155 Token proxy
     * @param name The name of the ERC-1155 Token proxy
     * @param baseURI The base URI of the ERC-1155 Token proxy
     * @param salt The deployment salt
     * @return proxyAddr The address of the ERC-1155 Token Proxy
     */
    function deploy(address owner, string memory name, string memory baseURI, bytes32 salt)
        external
        returns (address proxyAddr);
}