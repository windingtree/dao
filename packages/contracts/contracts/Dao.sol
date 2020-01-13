pragma solidity 0.5.14;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "openzeppelin-solidity/contracts/access/roles/WhitelistedRole.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./libraries/VotingLib.sol";


/**
 * @title Universal DAO for projects based on Openzeppelin SDK
 * @dev This contract holds main DAO logic and storages
 * @author Kostiantyn Smyrnov <kostysh@gmail.com>
 */
contract Dao is Initializable, Pausable, WhitelistedRole {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /**
     * @dev List of acceptable proposal types
     * Usefull for filtering purposes
     */
    enum ProposalType {
        ContractUpgrade,
        MethodCall
    }

    /**
     * @dev Acceptable vote types
     */
    enum VoteType {
        Yes,
        No
    }

    /**
     * @dev Proposal transaction
     * @param destination Transaction target address
     * @param value Ethers value to send with transaction
     * @param data Signed transaction data
     * @param executed Transaction execution flag
     * @param success Transaction execution result
     */
    struct Transaction {
        address destination;
        uint256 value;
        bytes data;
        bool executed;
        bool success;
    }

    /**
     * @dev Proposal structure
     * @param proposer Proposer address
     * @param details Proposal description. Can be text|IPFS Hash|Url|Etc
     * @param proposalType Proposal type
     * @param transaction Transaction storage
     * @param duration Proposal duration in days
     * @param end Proposal voting end date
     * @param flags Proposal state flags [passed, processed, cancelled]
     */
    struct Proposal {
        address proposer;
        string details;
        ProposalType proposalType;
        Transaction transaction;
        uint256 duration;
        uint256 end;
        bool[3] flags;
    }

    /**
     * @dev Vote structure
     * @param voteType Type of the vote
     * @param valueOriginal Original vote value (not converted)
     * @param valueAccepted Accepted vote value (converted)
     * @param revoked Revoked flag
     * @param withdrawn If vote has been withdrawn or no
     */
    struct Vote {
        VoteType voteType;
        uint256 valueOriginal;
        uint256 valueAccepted;
        bool revoked;        
        bool withdrawn;
    }

    /**
     * @dev Voting structure
     * @param ids List of the voters votes Ids (indexes)
     * @param voted List voted voters
     * @param votes List of votes
     * @param votesCount Votes counter
     */
    struct Voting {
        mapping (address => uint256) ids;// voterAddress => voteId
        mapping (address => bool) voted;// voterAddress => bool
        mapping (uint256 => Vote) votes;// voteId => Vote
        uint256 votesCount;
    }

    /**
     * @dev This event will be emitted when proposal has been added
     * @param proposer Proposer address
     * @param proposalId Proposal Id
     */
    event ProposalAdded(
        address proposer,
        uint256 proposalId
    );

    /**
     * @dev This event will be emitted when proposal has been cancelled
     * @param proposalId Proposal Id
     */
    event ProposalCancelled(uint256 proposalId);

    /**
     * @dev This event will be emitted when Vote is accepted
     * @param proposalId Proposal Id
     * @param voteType Type of the vote
     * @param voter Voter address
     * @param votes Original votes sent
     * @param votesAccepted Accepted votes amount
     */
    event VoteAdded(
        uint256 proposalId,
        VoteType voteType,
        address voter,
        uint256 votes,
        uint256 votesAccepted
    );

    /**
     * @dev This event will be emitted when existed Vote is revoked
     * @param proposalId Proposal Id
     * @param voteType Type of the vote
     * @param voter Voter address
     * @param votes Original votes revoked
     */
    event VoteRevoked(
        uint256 proposalId,
        VoteType voteType,
        address voter,
        uint256 votes
    );

    /**
     * @dev This event will be emitted when service tokens are locked
     * @param voter Voter address
     * @param value Locked tokens amount
     */
    event TokensLocked(
        address voter,
        uint256 value
    );

    /**
     * @dev This event will be emitted when service tokens are released
     * @param voter Voter address
     * @param value Released tokens amount
     */
    event TokensReleased(
        address voter,
        uint256 value
    );

    /**
     * @dev This event will be emitted when proposal moved to processed state
     * @param proposalId Proposal Id
     * @param executor Address of proposal executor
     * @param passed Voting result
     */
    event ProposalProcessed(
        uint256 proposalId,
        address executor,
        bool passed
    );

    /**
     * @dev This event will be emitted when sent proposal transaction has succeeded
     * @param proposalId Proposal Id
     */
    event TransactionSuccessed(uint256 proposalId);

    /**
     * @dev This event will be emitted when sent proposal transaction has failed
     * @param proposalId Proposal Id
     */
    event TransactionFailed(uint256 proposalId);

    /// @dev ERC20 Token that using in voting process
    IERC20 public serviceToken;

    /// @dev Number of proposals
    uint256 public proposalCount;
    
    /// @dev Proposals storage
    mapping (uint256 => Proposal) internal proposals;// proposalId => Proposal

    /// @dev Proposals votings 
    mapping (uint256 => Voting) internal votings;// proposalId => Voting


    /**
     * @dev This modifier allows function execution if proposal exist only
     * @param proposalId Proposal Id
     */
    modifier proposalExists(uint256 proposalId) {
        require(proposals[proposalId].duration != 0, "Dao: PROPOSAL_NOT_FOUND");
        _;
    }
    
    /**
     * @dev This modifier allows function execution for the proposer only
     * @param proposalId Proposal Id
     */
    modifier onlyProposer(uint256 proposalId) {
        require(msg.sender == proposals[proposalId].proposer, "Dao: NOT_A_PROPOSER");
        _;
    }

    /**
     * @dev This modifier allows function execution if proposal has not passed flag
     * @param proposalId Proposal Id
     */
    modifier notPassed(uint256 proposalId) {
        require(!proposals[proposalId].flags[0], "Dao: PROPOSAL_PASSED");
        _;
    }

    /**
     * @dev This modifier allows function execution if proposal has not processed flag
     * @param proposalId Proposal Id
     */
    modifier notProcessed(uint256 proposalId) {
        require(!proposals[proposalId].flags[1], "Dao: PROPOSAL_PROCESSED");
        _;
    }

    /**
     * @dev This modifier allows function execution if proposal has not cancelled flag
     * @param proposalId Proposal Id
     */
    modifier notCancelled(uint256 proposalId) {
        require(!proposals[proposalId].flags[2], "Dao: PROPOSAL_CANCELLED");
        _;
    }

    /**
     * @dev This modifier allows function execution if proposal not finished
     * @param proposalId Proposal Id
     */
    modifier notFinished(uint256 proposalId) {
        require(time() < proposals[proposalId].end, "Dao: PROPOSAL_FINISHED");
        _;
    }

    /**
     * @dev This modifier allows function execution if proposal finished only
     * @param proposalId Proposal Id
     */
    modifier onlyFinished(uint256 proposalId) {
        require(time() >= proposals[proposalId].end, "Dao: PROPOSAL_NOT_FINISHED");
        _;
    }

    /**
     * @dev This modifier allows function execution if sender already voted for proposal
     * @param proposalId Proposal Id
     */
    modifier voteExists(uint256 proposalId) {
        require(votings[proposalId].voted[msg.sender], "Dao: VOTE_NOT_FOUND");
        _;
    }

    /**
     * @dev Contract initializer
     * @param token Address of the service token
     */
    function initialize(address token) external initializer {
        serviceToken = IERC20(token);
        proposalCount = 0;

        // Add proxy owner PuserRole
        _addPauser(msg.sender);

        // Add proxy owner WhitelistAdminRole
        _addWhitelistAdmin(msg.sender);
    }

    /**
     * @dev Add new proposal
     *
     * Requirements:
     *  - sender address should be whitelisted
     *  - contract should not be in paused state
     *  - proposal type should allowed proposalType
     *  - destination address should not be a valid target address
     *  - sent ether value should be consistent with value parameter
     * 
     * @param details Proposal details
     * @param proposalType Proposal type
     * @param duration Proposal voting duration in days
     * @param destination Transaction target address
     * @param value Transaction value in ethers
     * @param data Signed transaction data
     */
    function addProposal(
        string calldata details,
        ProposalType proposalType,
        uint256 duration,
        address destination,
        uint256 value,
        bytes calldata data
    ) external payable onlyWhitelisted whenNotPaused {
        assertProposalType(proposalType);// Throws an Invalid opcode if proposalType not valid
        // @todo Add conditions and test for proposal `duration` (s.l. min and max value)
        require(destination != address(0), "Dao: INVALID_DESTINATION");
        require(value == 0 || (value > 0 && msg.value >= value), "Dao: INSUFFICIENT_ETHER_VALUE");

        emit ProposalAdded(msg.sender, proposalCount);

        bool[3] memory flags;
        proposals[proposalCount] = Proposal(
            msg.sender,
            details,
            proposalType,
            Transaction(
                destination,
                value,
                data,
                false,
                false
            ),
            duration,
            time().add(duration.mul(86400)),
            flags
        );
        
        proposalCount = proposalCount.add(1);
    }

    /**
     * @dev Cancelling of the proposal
     *
     * Requirements:
     *  - proposal should exists
     *  - sender address should be a proposer address
     *  - proposal should not be in a passed state
     *  - proposal should not be in a processed state
     *  - proposal should not be cancelled
     *  - proposal has no votes
     *
     * @param proposalId Proposal Id
     */
    function cancelProposal(uint256 proposalId) 
        external 
        proposalExists(proposalId)
        onlyProposer(proposalId)
        notPassed(proposalId) 
        notProcessed(proposalId) 
        notCancelled(proposalId)
    {
        (uint256 yes, uint256 no) = votingResult(proposalId);
        require(yes == 0 && no == 0, "Dao: PROPOSAL_HAS_VOTES");
        proposals[proposalId].flags[2] = true;
        emit ProposalCancelled(proposalId);
    }

    /**
     * @dev Vote for the proposal
     *
     * Requirements:
     *  - proposal should exists
     *  - contract not paused
     *  - proposal should not be in a passed state
     *  - proposal should not be cancelled
     *  - sender tokens balance should be sufficient
     *  - tokens allowance for the DAO address should be sufficient
     *  - voting not expired (does not exceed voting time frame)
     *
     * @param proposalId Proposal Id
     * @param voteType Type of the vote (Yes/No)
     * @param votes Amount of service token to use in the vote
     */
    function vote(
        uint256 proposalId,
        VoteType voteType, 
        uint256 votes
    ) 
        external 
        whenNotPaused  
        proposalExists(proposalId)
        notPassed(proposalId) 
        notCancelled(proposalId)
        notFinished(proposalId)
    {
        require(serviceToken.balanceOf(msg.sender) >= votes, "Dao: INSUFFICIENT_TOKENS_BALANCE");
        require(serviceToken.allowance(msg.sender, address(this)) >= votes, "Dao: INSUFFICIENT_TOKENS_ALLOWANCE");

        // Transfer tokens to the DAO
        lockTokens(msg.sender, votes);
        
        uint256 votesAccepted;
        
        if (!votings[proposalId].voted[msg.sender]) {
            
            // Create new Vote
            votings[proposalId].voted[msg.sender] = true;
            uint256 voteId = votings[proposalId].votesCount;
            votings[proposalId].ids[msg.sender] = voteId;
            votesAccepted = convertVotes(votes);
            votings[proposalId].votes[voteId] = Vote(
                voteType,
                votes,
                votesAccepted,
                false,
                false
            );
            
            // Update votes counter
            votings[proposalId].votesCount = votings[proposalId].votesCount.add(1);
        } else {
            
            // Re-use existed Vote
            Vote storage existedVote = votings[proposalId].votes[votings[proposalId].ids[msg.sender]];
            
            if (existedVote.revoked) {

                // Enable revoked vote status
                existedVote.revoked = false;
                existedVote.withdrawn = false;
                votesAccepted = convertVotes(votes);
            } else {

                // For now allowed adding new value only
                // @todo Implement conditional update: if votesSent less then previous value then do partial withdraw
                votes = existedVote.valueOriginal.add(votes);
                votesAccepted = convertVotes(votes);

                // Emitting this event for consistency
                emit VoteRevoked(
                    proposalId,
                    existedVote.voteType,
                    msg.sender,
                    existedVote.valueOriginal
                );
            }

            // Update existed Vote
            existedVote.voteType = voteType;
            existedVote.valueOriginal = votes;            
            existedVote.valueAccepted = votesAccepted;
        }

        emit VoteAdded(
            proposalId,
            voteType,
            msg.sender,
            votes,
            votesAccepted
        );
    }

    /**
     * @dev Revoke of the placed vote
     *
     * Requirements:
     *  - proposal should exists
     *  - proposal should not be in a passed state
     *  - proposal should not be cancelled
     *  - vote should not been already revoked
     *
     * @param proposalId Proposal Id
     */
    function revokeVote(uint256 proposalId) 
        external 
        proposalExists(proposalId)
        notPassed(proposalId) 
        notCancelled(proposalId)
    {
        Vote storage existedVote = votings[proposalId]
            .votes[votings[proposalId].ids[msg.sender]];

        require(!existedVote.revoked, "Dao: VOTE_REVOKED");

        // Exclude vote from the voting results
        existedVote.revoked = true;
        existedVote.withdrawn = true;
        
        // Push tokens to the voter
        releaseTokens(msg.sender, existedVote.valueOriginal);
                
        emit VoteRevoked(
            proposalId,
            existedVote.voteType,
            msg.sender,
            existedVote.valueOriginal
        );
    }

    /**
     * @dev Process proposal
     *
     * Requirements:
     *  - proposal should exists
     *  - contract not paused
     *  - proposal should not be processed
     *  - proposal should not be cancelled
     *  - proposal is finished
     *
     * @param proposalId Proposal Id
     */
    function processProposal(uint256 proposalId) 
        external 
        whenNotPaused 
        proposalExists(proposalId) 
        notProcessed(proposalId) 
        notCancelled(proposalId) 
        onlyFinished(proposalId)
    {
        Proposal storage proposal = proposals[proposalId];
        proposal.flags[1] = true; // 'processed' state

        bool isPassed = isVotingPassed(proposalId);
        
        if (isPassed && !proposal.transaction.executed) {

            proposal.flags[0] = true; // 'passed' state
            proposal.transaction.executed = true;
            
            bool success = executeTransaction(
                proposal.transaction.destination,
                proposal.transaction.value,
                proposal.transaction.data
            );

            if (success) {

                proposal.transaction.success = true;
                emit TransactionSuccessed(proposalId);
            } else {

                emit TransactionFailed(proposalId);
            }
        }

        emit ProposalProcessed(proposalId, msg.sender, isPassed);
    }

    /**
     * @dev Withdraw released tokens
     *
     * Requirements:
     *  - proposal should exists
     *  - proposal should be finished
     *  - sender has positive locked tokens balance
     *
     * @param proposalId Proposal Id
     */
    function withdrawTokens(uint256 proposalId) 
        external 
        proposalExists(proposalId) 
        onlyFinished(proposalId)
    {
        uint256 tokensBalance = tokensBalance(proposalId);
        require(tokensBalance > 0, "Dao: INSUFFICIENT_TOKENS_BALANCE");

        Vote storage existedVote = votings[proposalId]
            .votes[votings[proposalId].ids[msg.sender]];

        // Push tokens to the voter
        existedVote.withdrawn = true;
        releaseTokens(msg.sender, existedVote.valueOriginal);
    }

    /**
     * @dev Get proposal by Id (index)
     *
     * Requirements:
     *  - proposal should exists 
     * 
     * @param proposalId Proposal Id
     * @return string Proposal details
     * @return ProposalType Proposal type
     * @return uint256 Proposal duration in days
     * @return uint256 Proposal end date
     * @return bool[3] Proposal status flags
     * @return address Transaction target address
     * @return uint256 Ether value to send with transaction
     * @return bytes Transaction data
     * @return bool Transaction execution status
     * @return bool Transaction execution result status
     */
    function getProposal(uint256 proposalId) 
        external 
        view 
        proposalExists(proposalId)
        returns (
            string memory details,
            ProposalType proposalType,
            uint256 duration,
            uint256 end,
            bool[3] memory flags,
            address txDestination,
            uint256 txValue,
            bytes memory txData,
            bool txExecuted,
            bool txSuccess
        ) 
    {
        Proposal storage existedProposal = proposals[proposalId];
        details = existedProposal.details;
        proposalType = existedProposal.proposalType;
        duration = existedProposal.duration;
        end = existedProposal.end;
        flags = existedProposal.flags;
        txDestination = existedProposal.transaction.destination;
        txValue = existedProposal.transaction.value;
        txData = existedProposal.transaction.data;
        txExecuted = existedProposal.transaction.executed;
        txSuccess = existedProposal.transaction.success;
    }

    /**
     * @dev Get own vote from proposal voting
     * 
     * Requirements:
     *  - proposal should exists
     *  - vote should be exist
     * 
     * @param proposalId Proposal Id
     * @return VoteType Type of the vote
     * @return uint256 Original vote value sent
     * @return uint256 Acceptes vote value
     * @return bool Reveked state of the vote
     */
    function getVote(uint256 proposalId) 
        external 
        view 
        proposalExists(proposalId)
        voteExists(proposalId)
        returns(
            VoteType voteType,
            uint256 valueOriginal,
            uint256 valueAccepted,
            bool revoked
        ) 
    {
        Vote storage senderVote = votings[proposalId]
            .votes[votings[proposalId].ids[msg.sender]];
        voteType = senderVote.voteType;
        valueOriginal = senderVote.valueOriginal;
        valueAccepted = senderVote.valueAccepted;
        revoked = senderVote.revoked;
    }

    /**
     * @dev Get all active proposals Ids
     * @return uint256[] List of proposals Ids
     */
    function getActiveProposalsIds() 
        external 
        view 
        returns (uint256[] memory) 
    {
        uint256[] memory ids = new uint256[](activeProposalsCount());
        uint256 index;

        for (uint256 i = 0; i < proposalCount; i++) {

            if (!proposals[i].flags[0] && 
                !proposals[i].flags[1] &&
                !proposals[i].flags[2] &&
                time() < proposals[i].end) {
                
                ids[index] = i;
                index += 1;
            }
        }

        return ids;
    }

    /**
     * @dev Get all active proposals Ids filtered by proposal type
     *
     * Requirements:
     *  - proposal type should be valid 
     * 
     * @return uint256[] List of proposals Ids
     */
    function getActiveProposalsIds(ProposalType proposalType) 
        external 
        view 
        returns (uint256[] memory) 
    {
        assertProposalType(proposalType);// Throws an Invalid opcode if proposalType not valid

        uint256[] memory ids = new uint256[](activeProposalsCount(proposalType));
        uint256 index;

        for (uint256 i = 0; i < proposalCount; i++) {

            if (!proposals[i].flags[0] && 
                !proposals[i].flags[1] &&
                !proposals[i].flags[2] &&
                time() < proposals[i].end &&
                proposals[i].proposalType == proposalType) {
                
                ids[index] = i;
                index += 1;
            }
        }

        return ids;
    }

    /**
     * @dev Replace pauser to the new one
     * 
     * Requirements:
     *  - sender address should be a pauser address
     * 
     * @param account New DAO pauser address
     */
    function replacePauser(address account) external onlyPauser {
        _addPauser(account);
        _removePauser(msg.sender);
    }

    /**
     * @dev Replace whitelist admin with new one
     * 
     * Requirements:
     *  - sender address should be a whitelisted admin address
     * 
     * @param account New DAO whitelist admin address
     */
    function replaceWhitelistAdmin(address account) external onlyWhitelistAdmin {
        _addWhitelistAdmin(account);
        _removeWhitelistAdmin(msg.sender);
    }

    /**
     * @dev Balance of locked tokens
     * @param proposalId Proposal Id
     * @return uint256 Balance of tokens that available to withdraw
     */
    function tokensBalance(uint256 proposalId) 
        public 
        view 
        proposalExists(proposalId) 
        returns (uint256) 
    {
        uint256 lockedTokens;

        // Proposal not cancelled
        // Voter has voted
        // Voter nas not withdrawn locked tokens
        if (!proposals[proposalId].flags[2] &&
            votings[proposalId].voted[msg.sender] &&
            !votings[proposalId]
                .votes[votings[proposalId].ids[msg.sender]]
                .withdrawn) {
            
            lockedTokens = votings[proposalId]
                .votes[votings[proposalId].ids[msg.sender]]
                .valueOriginal;
        }

        return lockedTokens;
    }

    /**
     * @dev Get a result of the proposal voting
     *
     * Requirements:
     *  - proposal should exists
     *
     * @param proposalId Proposal Id
     * @return uint256 'Yes' variant voting balance
     * @return uint256 'No' variant voting balance
     */
    function votingResult(uint256 proposalId) 
        public 
        view 
        proposalExists(proposalId)
        returns(
            uint256 yes, 
            uint256 no
        ) 
    {
        
        for (uint256 i = 0; i < votings[proposalId].votesCount; i++) {
            
            if (!votings[proposalId].votes[i].revoked) {

                if (votings[proposalId].votes[i].voteType == VoteType.Yes) {
                    yes = yes.add(votings[proposalId].votes[i].valueAccepted);
                }

                if (votings[proposalId].votes[i].voteType == VoteType.No) {
                    no = no.add(votings[proposalId].votes[i].valueAccepted);
                }
            }
        }
    }

    /**
     * @dev Check is voting is passed 
     *
     * Requirements:
     *  - proposal should exists
     *
     * @param proposalId Proposal Id
     * @return uint256 Voting result
     */
    function isVotingPassed(uint256 proposalId) 
        public 
        view 
        proposalExists(proposalId)
        returns(bool) 
    {
        
        if (proposals[proposalId].flags[0]) {
            // We already know result
            return true;
        } else if (proposals[proposalId].flags[2]) {
            // Cancelled proposals are not passing
            return false;
        } else if (time() < proposals[proposalId].end) {
            // Voting not finished yet
            return false;
        } else {

            (uint256 yes, uint256 no) = votingResult(proposalId);
            return yes > no;
        }
    }

    /**
     * @dev Return active proposals count
     * @return uint256
     */
    function activeProposalsCount() internal view returns (uint256) {
        uint256 count;

        for (uint256 i = 0; i < proposalCount; i++) {

            if (!proposals[i].flags[0] && 
                !proposals[i].flags[1] &&
                !proposals[i].flags[2] &&
                time() < proposals[i].end) {
                
                count = count.add(1);
            }
        }

        return count;
    }

    /**
     * @dev Return active proposals count
     * @param proposalType Type of proposal
     * @return uint256
     */
    function activeProposalsCount(ProposalType proposalType) 
        internal 
        view 
        returns (uint256) 
    {
        uint256 count;

        for (uint256 i = 0; i < proposalCount; i++) {

            if (!proposals[i].flags[0] && 
                !proposals[i].flags[1] &&
                !proposals[i].flags[2] &&
                time() < proposals[i].end &&
                proposals[i].proposalType == proposalType) {
                
                count = count.add(1);
            }
        }

        return count;
    }

    /**
     * @dev Transfer service tokens from the voter to the DAO
     * @param voter Proposal voter
     * @param value Amount of service tokens to transfer
     */
    function lockTokens(
        address voter, 
        uint256 value
    ) internal {
        serviceToken.safeTransferFrom(voter, address(this), value);
        emit TokensLocked(
            voter,
            value
        );
    }

    /**
     * @dev Release locked tokens for the voter
     * @param voter Proposal voter
     * @param value Amount of service tokens to transfer
     */
    function releaseTokens(
        address voter,
        uint256 value
    ) internal {
        serviceToken.safeTransfer(voter, value);
        emit TokensReleased(
            voter,
            value
        );
    }

    /**
     * @dev Send a transaction for the proposal
     * @param destination Target address to send transaction
     * @param value Ether value to send
     * @param data Call data
     * @return bool Transaction execution status
     */
    function executeTransaction(
        address destination,
        uint256 value,
        bytes memory data
    ) internal returns (bool success) {
        
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            success := call(
                sub(gas, 34710), 
                destination, 
                value, 
                add(data, 0x20), 
                mload(data), 
                0, 
                0
            )
        }
    }

    /**
     * @dev Convert votes using defined formula
     * @param votes Amount of service token to use in the vote
     * @return uint256 Converted votes value
     */
    function convertVotes(uint256 votes) internal pure returns (uint256) {
        return VotingLib.sqrt(votes);
    }

    /**
     * @dev Get current time
     *  
     * This function can be overriden for testing purposes
     * 
     * @return uint256 Current block time
     */
    function time() internal view returns (uint256) {
        return now;// solhint-disable-line not-rely-on-time
    }

    /**
     * @dev Validate given ProposalType value
     * @param typeValue Value of ProposalType to validate
     * @return uint256 Validation result (or throws Invalide opcode instead)
     */
    function assertProposalType(ProposalType typeValue) private pure returns (uint256) {
        return uint256(typeValue);
    }

    // @todo Add function to withdraw ether funds from contract 
}