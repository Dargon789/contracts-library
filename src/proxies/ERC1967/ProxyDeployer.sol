// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.17;

import {ProxyDeployerErrors} from "./ProxyDeployerErrors.sol";
import {Proxy} from "./Proxy.sol";

abstract contract ProxyDeployer is ProxyDeployerErrors {
    /**
     * Creates a proxy contract for a given implementation
     * @param implAddr The address of the proxy implementation
     * @param salt The deployment salt
     * @return proxyAddr The address of the deployed proxy
     */
    function _deployProxy(address implAddr, bytes32 salt) internal returns (address proxyAddr) {
        bytes memory code = _getProxyCode(implAddr);

        // Deploy it
        assembly { // solhint-disable-line no-inline-assembly
            proxyAddr := create2(0, add(code, 32), mload(code), salt)
        }
        if (proxyAddr == address(0)) {
            revert ProxyCreationFailed();
        }
        return proxyAddr;
    }

    /**
     * Predict the deployed wrapper proxy address for a given implementation.
     * @param implAddr The address of the proxy implementation
     * @param salt The deployment salt
     * @return proxyAddr The address of the deployed wrapper
     */
    function predictProxyAddress(address implAddr, bytes32 salt) public view returns (address proxyAddr) {
        bytes memory code = _getProxyCode(implAddr);
        return _predictProxyAddress(code, salt);
    }

    /**
     * Predict the deployed wrapper proxy address for a given implementation.
     * @param code The code of the wrapper implementation
     * @param salt The deployment salt
     * @return proxyAddr The address of the deployed wrapper
     */
    function _predictProxyAddress(bytes memory code, bytes32 salt) private view returns (address proxyAddr) {
        address deployer = address(this);
        bytes32 data = keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, keccak256(code)));
        return address(uint160(uint256(data)));
    }

    /**
     * Returns the code of the proxy contract for a given implementation
     * @param implAddr The address of the proxy implementation
     * @return code The code of the proxy contract
     */
    function _getProxyCode(address implAddr) private pure returns (bytes memory code) {
        return abi.encodePacked(type(Proxy).creationCode, abi.encode(implAddr));
    }

    /**
     * Checks if an address is a contract
     * @param addr The address to check
     * @return result True if the address is a contract
     */
    function _isContract(address addr) internal view returns (bool result) {
        uint256 csize;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            csize := extcodesize(addr)
        }
        return csize != 0;
    }
}