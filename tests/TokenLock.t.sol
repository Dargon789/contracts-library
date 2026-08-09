// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/Token.sol";

contract TokenLockTest is Test {
    Token token;

    function setUp() public {
        token = new Token();
    }

    function testTransferLocked(address holder, address receiver) public {
        vm.assume(holder != receiver);
        token.lock(holder);

        emit log_named_bool("IsLocked", token.isLocked(holder));

        vm.prank(holder);
        vm.expectRevert("TRANSFER_LOCKED");
        token.transfer(receiver, 100);
    }
}
