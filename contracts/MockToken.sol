pragma solidity ^0.4.18;

import "./installed/token/StandardToken.sol";


contract MockToken is StandardToken {
    function setBalance(uint _value) public {
        balances[msg.sender] = _value;
    }
}
