require('chai')
    .use(require('bn-chai')(web3.utils.BN))
    .should();

const packageJson = require('../package.json');
const {
    zeroAddress, 
    ProposalType,
    VoteType,
    unknownId
} = require('./helpers/constants');
const { assertRevert, assertEvent } = require('./helpers/assertions');
const { buildCallData } = require('./helpers/transactions');
const { toBN, toWeiBN, toWeiEther, dateTimeFromDuration } = require('./helpers/common');
const { isqrt } = require('./helpers/bnmath');
const {
    createTokenAndDistribute,
    createDaoContract,
    createTargetContract
} = require('./helpers/contracts');
const {
    addProposal,
    cancelProposal,
    doVote,
    revokeVote,
    votingCampaign,
    processProposal,
    pauseDao,
    withdrawTokens
} = require('./helpers/dao');
const { TestHelper } = require('@openzeppelin/cli');
const { Contracts, ZWeb3 } = require('@openzeppelin/upgrades');

let gasLimit = 8000000;// Like actual to the Ropsten

if (process.env.SOLIDITY_COVERAGE) {
    gasLimit = 0xfffffffffff;
    Contracts.setLocalBuildDir('./.coverage_artifacts/contracts');
}

// workaround for https://github.com/zeppelinos/zos/issues/704
Contracts.setArtifactsDefaults({
    gas: gasLimit,
});

ZWeb3.initialize(web3.currentProvider);

const Erc20Token = Contracts.getFromLocal('Erc20Token');
const Dao = Contracts.getFromLocal('DaoWithTimeMachine');
const ContractForDaoTestsV1 = Contracts.getFromLocal('ContractForDaoTestsV1');
const ContractForDaoTestsV2 = Contracts.getFromLocal('ContractForDaoTestsV2');

contract('DAO', accounts => {
    const tokenOwner = accounts[1];
    const initialProxyOwner = accounts[2];
    const initialTargetOwner = accounts[3];
    const proposalCreator1 = accounts[4];
    const voter1 = accounts[6];
    const voter2 = accounts[7];
    const voter3 = accounts[8];
    const voter4 = accounts[9];

    // values in ether
    const tokensDistribution = [
        {
            owner: voter1,
            value: '100'
        },
        {
            owner: voter2,
            value: '200'
        },
        {
            owner: voter3,
            value: '500'
        },
        {
            owner: voter4,
            value: '100'
        },
        // voter5 will still with empty balance
    ];

    // Voting campaign template
    const campaign = [
        {
            voter: voter1,
            votes: '5'
        },
        {
            voter: voter2,
            votes: '3'
        },
        {
            voter: voter3,
            votes: '20'
        },
        {
            voter: voter4,
            votes: '5'
        }
    ];

    let token;
    let project;
    let dao;
    let daoPaused;
    let target;

    beforeEach(async () => {
        // Create service token instance
        token = await createTokenAndDistribute(
            Erc20Token,
            '0',
            tokenOwner,
            tokensDistribution
        );
        
        // Create upgradeability project
        project = await TestHelper({
            from: initialProxyOwner
        });

        // DAO instances
        dao = await createDaoContract(
            project,
            Dao,
            token.address,
            initialProxyOwner,
            [proposalCreator1]
        );

        // paused instance
        daoPaused = await createDaoContract(
            project,
            Dao,
            token.address,
            initialProxyOwner,
            [proposalCreator1],
            true,
            true
        );

        // Target contract for testing governance features of DAO
        target = await createTargetContract(
            project,
            ContractForDaoTestsV1,
            dao,
            initialTargetOwner
        );

        // Grant ability to upgrade all implementations via Dao only
        await project.transferAdminOwnership(dao.address);
    });

    describe('Ownership and upgradeability', () => {

        describe('Proxy admin', () => {

            it('should be owned by the Dao', async () => {
                (await project.proxyAdmin.getOwner()).should.equal(dao.address);
            });
        });

        describe('Dao governance', () => {

            describe('Upgradeability', () => {

                it('should fail if trying to upgrade not by Dao', async () => {
                    await assertRevert(project.upgradeProxy(dao.address, Dao, {
                        from: initialProxyOwner// Not a proxyAdmin owner after setup
                    }));
                });
            });

            describe('Whitelisting', () => {

                it('should be administrated by the Dao', async () => {
                    (await dao.methods['isWhitelistAdmin(address)'](dao.address).call()).should.be.true;
                    (await dao.methods['isWhitelistAdmin(address)'](initialProxyOwner).call()).should.be.false;
                });

                describe('#replaceWhitelistAdmin(address)', () => {
        
                    it('should fail if sender not a WhitelistAdmin', async () => {
                        await assertRevert(
                            dao.methods['replaceWhitelistAdmin(address)'](voter1).send({
                                from: voter1
                            }),
                            'WhitelistAdminRole: caller does not have the WhitelistAdmin role'
                        );
                    });
            
                    it('should replace existed WhitelistAdmin to the new one', async () => {
                        // We can do this via Dao workflow 
                        // Add proposal
                        const proposalId = await addProposal(
                            dao,
                            proposalCreator1,
                            {
                                details: 'Replace Dao whitelist admin',
                                proposalType: ProposalType.MethodCall,
                                duration: '10',
                                value: '0',
                                destination: dao.address,
                                methodName: 'replaceWhitelistAdmin',
                                methodParamTypes: ['address'],
                                methodParams: [voter1]
                            }
                        );

                        // Fulfill voting (to success result)
                        await votingCampaign(dao, proposalId, VoteType.Yes, campaign);

                        // Rewind Dao time to the end of a voting
                        const endDate = dateTimeFromDuration(10) + 1;
                        await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

                        // Process
                        await processProposal(
                            dao,
                            proposalId,
                            proposalCreator1,
                            VoteType.Yes, 
                            campaign
                        );
                        
                        // Check result
                        (await dao.methods['isWhitelistAdmin(address)'](voter1).call()).should.be.true;
                    }); 
                });
            });

            describe('Pausable behaviour', () => {

                it('should be administrated by the Dao', async () => {
                    (await dao.methods['isPauser(address)'](dao.address).call()).should.be.true;
                    (await dao.methods['isPauser(address)'](initialProxyOwner).call()).should.be.false;
                });

                describe('#replacePauser(address)', () => {

                    it('should fail if sender not a pauser', async () => {
                        await assertRevert(
                            dao.methods['replacePauser(address)'](voter1).send({
                                from: voter1
                            }),
                            'PauserRole: caller does not have the Pauser role'
                        );
                    });
            
                    it('should replace existed pauser to the new one', async () => {
                        // We can do this via Dao workflow 
                        // Add proposal
                        const proposalId = await addProposal(
                            dao,
                            proposalCreator1,
                            {
                                details: 'Replace Dao pauser account',
                                proposalType: ProposalType.MethodCall,
                                duration: '10',
                                value: '0',
                                destination: dao.address,
                                methodName: 'replacePauser',
                                methodParamTypes: ['address'],
                                methodParams: [voter1]
                            }
                        );

                        // Fulfill voting (to success result)
                        await votingCampaign(dao, proposalId, VoteType.Yes, campaign);

                        // Rewind Dao time to the end of a voting
                        const endDate = dateTimeFromDuration(10) + 1;
                        await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

                        // Process
                        await processProposal(
                            dao,
                            proposalId,
                            proposalCreator1,
                            VoteType.Yes, 
                            campaign
                        );
                        
                        // Check result
                        (await dao.methods['isPauser(address)'](voter1).call()).should.be.true;
                    }); 
                });
            });
        });

        describe('Governed (target) contract', () => {

            describe('Upgradeability', () => {

                it('should fail if trying to upgrade not by Dao', async () => {
                    await assertRevert(project.upgradeProxy(target.address, ContractForDaoTestsV2, {
                        from: initialProxyOwner// Not a proxyAdmin owner after setup
                    }));
                });
            });

            describe('Ownable behaviour', () => {

                it('should be administrated by the Dao', async () => {
                    (await target.methods['owner()']().call()).should.equal(dao.address);
                });
            });
        });
    });

    describe('#addProposal(string,uint8,uint256,address,uint256,bytes)', () => {

        it('should fail if sender address not whitelisted', async () => {
            await assertRevert(dao.methods['addProposal(string,uint8,uint256,address,uint256,bytes)'](
                'Change target contract owner',
                ProposalType.MethodCall,
                '10',
                target.address,
                '0',
                buildCallData('transferOwnership(address)', ['address'], [voter1])
            ).send({
                from: voter1// Not whitelisted
            }), 'WhitelistedRole: caller does not have the Whitelisted role');
        });

        it('should fail if contract in a paused state', async () => {
            await assertRevert(daoPaused.methods['addProposal(string,uint8,uint256,address,uint256,bytes)'](
                'Change target contract owner',
                ProposalType.MethodCall,
                '10',
                target.address,
                '0',
                buildCallData('transferOwnership(address)', ['address'], [voter1])
            ).send({
                from: proposalCreator1
            }), 'Pausable: paused');
        });

        it('should fail if proposal type has unknown value', async () => {
            await assertRevert(dao.methods['addProposal(string,uint8,uint256,address,uint256,bytes)'](
                'Change target contract owner',
                5,// Wrong type
                '10',
                target.address,
                '0',
                buildCallData('transferOwnership(address)', ['address'], [voter1])
            ).send({
                from: proposalCreator1
            }));
        });

        it('should fail if destination target address equal to zero', async () => {
            await assertRevert(dao.methods['addProposal(string,uint8,uint256,address,uint256,bytes)'](
                'Change target contract owner',
                1,
                '10',
                zeroAddress,
                '0',
                buildCallData('transferOwnership(address)', ['address'], [voter1])
            ).send({
                from: proposalCreator1
            }), 'INVALID_DESTINATION');
        });

        it('sent ether value should be consistent with value parameter', async () => {
            await assertRevert(dao.methods['addProposal(string,uint8,uint256,address,uint256,bytes)'](
                'Change target contract owner',
                1,
                '10',
                target.address,
                web3.utils.toWei('1', 'ether'),
                buildCallData('transferOwnership(address)', ['address'], [voter1])
            ).send({
                from: proposalCreator1,
                value: web3.utils.toWei('0.9', 'ether')
            }), 'INSUFFICIENT_ETHER_VALUE');
        });

        it('should add new proposal (without sent ether value)', async () => {
            await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
        });

        it('should add new proposal (with sent ether value)', async () => {
            await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '1',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
        });
    });

    describe('#cancelProposal(uint256)', () => {
        let proposalId;

        beforeEach(async () => {
            // Add proposal
            proposalId = await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
        });

        it('should fail if proposal not existed', async () => {
            await assertRevert(dao.methods['cancelProposal(uint256)'](unknownId()).send({
                from: proposalCreator1
            }), 'PROPOSAL_NOT_FOUND');
        });

        it('should fail if sender address not a proposer address', async () => {
            await assertRevert(dao.methods['cancelProposal(uint256)'](proposalId).send({
                from: voter1// Not a proposer
            }), 'NOT_A_PROPOSER');
        });

        it('should fail if proposal in a passed state', async () => {
            // Fulfill voting (to success result)
            await votingCampaign(dao, proposalId, VoteType.Yes, campaign);

            // Rewind Dao time to the end of a voting
            const endDate = dateTimeFromDuration(11);
            await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

            // Process
            await processProposal(
                dao,
                proposalId,
                proposalCreator1,
                VoteType.Yes, 
                campaign
            );

            await assertRevert(
                dao.methods['cancelProposal(uint256)'](proposalId).send({
                    from: proposalCreator1
                }),
                'PROPOSAL_PASSED'
            );
        });

        it('should fail if proposal in a processed state', async () => {
            // Fulfill voting (to success result)
            await votingCampaign(dao, proposalId, VoteType.No, campaign);

            // Rewind Dao time to the end of a voting
            const endDate = dateTimeFromDuration(11);
            await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

            // Process
            await processProposal(
                dao,
                proposalId,
                proposalCreator1,
                VoteType.No, 
                campaign
            );

            await assertRevert(
                dao.methods['cancelProposal(uint256)'](proposalId).send({
                    from: proposalCreator1
                }),
                'PROPOSAL_PROCESSED'
            );
        });

        it('should fail if proposal cancelled', async () => {
            await cancelProposal(
                dao,
                proposalId,
                proposalCreator1
            );
            await assertRevert(dao.methods['cancelProposal(uint256)'](proposalId).send({
                from: proposalCreator1
            }), 'PROPOSAL_CANCELLED');
        });

        it('should fail if proposal already has votes', async () => {
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );
            await assertRevert(dao.methods['cancelProposal(uint256)'](proposalId).send({
                from: proposalCreator1
            }), 'PROPOSAL_HAS_VOTES');
        });
        
        it('should cancel proposal', async () => {
            await cancelProposal(
                dao,
                proposalId,
                proposalCreator1
            );
        });
    });

    describe('#vote(uint256,uint8,uint256)', () => {
        let proposalId;
        const proposalDuration = 10;// Days

        beforeEach(async () => {
            // Add proposal
            proposalId = await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: proposalDuration.toString(),
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
        });

        it('should fail if proposal not existed', async () => {
            const voteValue = toWeiBN('5').toString();
            await token.methods['approve(address,uint256)'](
                dao.address,
                voteValue
            ).send({
                from: voter1
            });
            await assertRevert(dao.methods['vote(uint256,uint8,uint256)'](
                unknownId(),
                VoteType.Yes,
                voteValue
            ).send({
                from: voter1
            }), 'PROPOSAL_NOT_FOUND');
        });

        it('should fail if contract is paused', async () => {
            await pauseDao(dao, proposalCreator1, campaign);
            await assertRevert(dao.methods['vote(uint256,uint8,uint256)'](
                proposalId,
                VoteType.Yes,
                toWeiBN('5').toString()
            ).send({
                from: voter1
            }), 'Pausable: paused');
        });

        it('should fail if proposal in a passed state', async () => {
            // Fulfill voting (to success result)
            await votingCampaign(dao, proposalId, VoteType.Yes, campaign);

            // Rewind Dao time to the end of a voting
            const endDate = dateTimeFromDuration(11);
            await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

            // Process
            await processProposal(
                dao,
                proposalId,
                proposalCreator1,
                VoteType.Yes, 
                campaign            );

            await assertRevert(
                dao.methods['vote(uint256,uint8,uint256)'](
                    proposalId,
                    VoteType.Yes,
                    toWeiBN('5').toString()
                ).send({
                    from: voter1
                }),
                'PROPOSAL_PASSED'
            );
        });

        it('should fail if proposal cancelled', async () => {
            await cancelProposal(
                dao,
                proposalId,
                proposalCreator1
            );
            await assertRevert(dao.methods['vote(uint256,uint8,uint256)'](
                proposalId,
                VoteType.Yes,
                toWeiBN('5').toString()
            ).send({
                from: voter1
            }), 'PROPOSAL_CANCELLED');
        });

        it('should fail if sender tokens balance insufficient', async () => {
            await assertRevert(dao.methods['vote(uint256,uint8,uint256)'](
                proposalId,
                VoteType.Yes,
                toWeiBN('150').toString()
            ).send({
                from: voter1
            }), 'INSUFFICIENT_TOKENS_BALANCE');
        });

        it('should fail if tokens allowance for the DAO address insufficient', async () => {
            await assertRevert(dao.methods['vote(uint256,uint8,uint256)'](
                proposalId,
                VoteType.Yes,
                toWeiBN('5').toString()
            ).send({
                from: voter1
            }), 'INSUFFICIENT_TOKENS_ALLOWANCE');
        });

        it('should fail if voting is expired', async () => {
            const expiredDate = dateTimeFromDuration(proposalDuration) + 1;
            await dao.methods['setCurrentTime(uint256)'](expiredDate.toString()).send();
            await assertRevert(dao.methods['vote(uint256,uint8,uint256)'](
                proposalId,
                VoteType.Yes,
                toWeiBN('5').toString()
            ).send({
                from: voter1
            }), 'PROPOSAL_FINISHED');
        });

        it('should accept a vote', async () => {
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );
        });

        it('should update an existed vote with a same VoteType', async () => {
            // Initial vote
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );

            // Update to previous vote
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,// Same VoteType
                '2',
                voter1
            );
        });

        it('should update an existed vote with different VoteType', async () => {
            // Initial vote
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );

            // Update to previous vote
            await doVote(
                dao,
                proposalId,
                VoteType.No,// Different VoteType
                '2',
                voter1
            );
        });

        it('should add a vote if previous has been revoked', async () => {
            // Initial vote
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );
            
            // Revoke this vote
            await revokeVote(
                dao,
                proposalId,
                voter1
            );

            // Add vote again
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '7',
                voter1
            );
        });
    });

    describe('#revokeVote(uint256)', () => {
        let proposalId;

        beforeEach(async () => {
            // Add proposal
            proposalId = await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );

            // Add a vote for proposal
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );
        });

        it('should fail if proposal not existed', async () => {
            await assertRevert(
                dao.methods['revokeVote(uint256)'](unknownId()).send({
                    from: voter1
                }),
                'PROPOSAL_NOT_FOUND'
            );
        });

        it('should fail if proposal in a passed state', async () => {
            // Fulfill voting (to success result)
            await votingCampaign(dao, proposalId, VoteType.Yes, campaign);

            // Rewind Dao time to the end of a voting
            const endDate = dateTimeFromDuration(11);
            await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

            // Process
            await processProposal(
                dao,
                proposalId,
                proposalCreator1,
                VoteType.Yes, 
                campaign,
                false,
                [// we need to count an initial vote also
                    {
                        voter: voter1,
                        votes: '5'
                    }
                ]
            );

            await assertRevert(
                dao.methods['revokeVote(uint256)'](proposalId).send({
                    from: voter1
                }),
                'PROPOSAL_PASSED'
            );
        });

        it('should fail if proposal cancelled', async () => {
            const proposalId = await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
            await cancelProposal(
                dao,
                proposalId,
                proposalCreator1
            );
            await assertRevert(
                dao.methods['revokeVote(uint256)'](proposalId).send({
                    from: voter1
                }),
                'PROPOSAL_CANCELLED'
            );
        });

        it('should fail if vote has been revoked before', async () => {
            await revokeVote(
                dao,
                proposalId,
                voter1
            );
            await assertRevert(
                dao.methods['revokeVote(uint256)'](proposalId).send({
                    from: voter1
                }),
                'VOTE_REVOKED'
            );
        });

        it('should revoke a vote', async () => {
            await revokeVote(
                dao,
                proposalId,
                voter1
            );
        });
    });

    describe('#processProposal(uint256)', () => {
                
        describe('In a case of the voting success', () => {
            let proposalId;
            let proposalConfig;
                        
            beforeEach(async () => {
                proposalConfig = {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                };
                
                // Add proposal
                proposalId = await addProposal(
                    dao,
                    proposalCreator1,
                    proposalConfig
                );

                // Fulfill voting (to success result)
                await votingCampaign(dao, proposalId, VoteType.Yes, campaign);

                // Rewind Dao time to the end of a voting
                const endDate = dateTimeFromDuration(Number(proposalConfig.duration)) + 1;
                await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();
            });

            it('should fail if contract is paused', async () => {
                await pauseDao(dao, proposalCreator1, campaign);
                await assertRevert(processProposal(
                    dao,
                    proposalId,
                    proposalCreator1,
                    VoteType.Yes, 
                    campaign
                ), 'Pausable: paused');
            });

            it('should fail if proposal not exists', async () => {
                await assertRevert(
                    dao.methods['processProposal(uint256)'](unknownId()).send({
                        from: proposalCreator1
                    }),
                    'PROPOSAL_NOT_FOUND'
                );
            });
    
            it('should fail if proposal has been processed before', async () => {
                await processProposal(
                    dao,
                    proposalId,
                    proposalCreator1,
                    VoteType.Yes, 
                    campaign
                );
                await assertRevert(
                    processProposal(
                        dao,
                        proposalId,
                        proposalCreator1,
                        VoteType.Yes, 
                        campaign
                    ),
                    'PROPOSAL_PROCESSED'
                );
            });
    
            it('should fail if proposal cancelled', async () => {
                // Add proposal 
                const proposalId = await addProposal(
                    dao,
                    proposalCreator1,
                    proposalConfig
                );

                // and cancel it
                await cancelProposal(
                    dao,
                    proposalId,
                    proposalCreator1
                );

                await assertRevert(
                    dao.methods['processProposal(uint256)'](proposalId).send({
                        from: proposalCreator1
                    }),
                    'PROPOSAL_CANCELLED'
                );
            });

            it('should fail if proposal not finished', async () => {
                // Add proposal 
                const proposalId = await addProposal(
                    dao,
                    proposalCreator1,
                    proposalConfig
                );

                await assertRevert(
                    dao.methods['processProposal(uint256)'](proposalId).send({
                        from: proposalCreator1
                    }),
                    'PROPOSAL_NOT_FINISHED'
                );
            });

            it('should process proposal with broken Tx properly', async () => {
                // Add proposal with broken Tx
                const duration = '10';
                const proposalId = await addProposal(
                    dao,
                    proposalCreator1,
                    {
                        details: 'Proposal with broken transaction',
                        proposalType: ProposalType.MethodCall,
                        duration: duration,
                        value: '0',
                        destination: target.address,
                        methodName: 'transferOwnership',
                        methodParamTypes: ['string'],// Wrong type
                        methodParams: ['blablabla']
                    }
                );
                // Fulfill voting (to success result)
                await votingCampaign(dao, proposalId, VoteType.Yes, campaign);

                // Rewind Dao time to the end of a voting
                const currentTimeBefore = await dao.methods['currentTime()']().call(); 
                const endDate = dateTimeFromDuration(Number(duration), Number(currentTimeBefore.toString()));
                await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

                await processProposal(
                    dao,
                    proposalId,
                    proposalCreator1,
                    VoteType.Yes, 
                    campaign,
                    true
                );
            });
    
            it('should process a proposal', async () => {
                // Owner of target contract before the process
                (await target.methods['owner()']().call()).should.equal(dao.address);

                await processProposal(
                    dao,
                    proposalId,
                    proposalCreator1,
                    VoteType.Yes, 
                    campaign
                );
                
                // And check a new owner according to the proposal
                (await target.methods['owner()']().call()).should.equal(voter1);
            });
        });
        
        describe('In a case of the voting failure', () => {
            let proposalId;
            let proposalConfig;

            beforeEach(async () => {
                proposalConfig = {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                };

                // Add proposal
                proposalId = await addProposal(
                    dao,
                    proposalCreator1,
                    proposalConfig
                );

                // Fulfill voting (to failure result)
                await votingCampaign(dao, proposalId, VoteType.No, campaign);

                // Rewind Dao time to the end of voting
                const endDate = dateTimeFromDuration(Number(proposalConfig.duration) + 1);
                await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();
            });

            it('should fail if contract is paused', async () => {
                await pauseDao(dao, proposalCreator1, campaign);
                await assertRevert(processProposal(
                    dao,
                    proposalId,
                    proposalCreator1,
                    VoteType.No, 
                    campaign
                ), 'Pausable: paused');
            });
    
            it('should process a proposal', async () => {
                await processProposal(
                    dao,
                    proposalId,
                    proposalCreator1,
                    VoteType.No, 
                    campaign
                );
            });

            it('should process a proposal if called by not a proposer', async () => {
                await processProposal(
                    dao,
                    proposalId,
                    voter1,
                    VoteType.No, 
                    campaign
                );
            });
        });
    });

    describe('#tokensBalance(uint256)', () => {
        let proposalId;

        beforeEach(async () => {
            // Add proposal
            proposalId = await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
        });

        it('should fail if proposal not found', async () => {
            await assertRevert(
                dao.methods['tokensBalance(uint256)'](unknownId()).call({
                    from: voter1
                }),
                'PROPOSAL_NOT_FOUND'
            );
        });

        it('should return 0 if votes are not been placed', async () => {
            ((await dao.methods['tokensBalance(uint256)'](proposalId).call({
                from: voter1
            })).toString()).should.equal('0');
        });

        it('should return 0 if votes are been placed but been revoked then', async () => {
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );
            await revokeVote(
                dao,
                proposalId,
                voter1
            );
            ((await dao.methods['tokensBalance(uint256)'](proposalId).call({
                from: voter1
            })).toString()).should.equal('0');
        });

        it('should return a balance of tokens available to withdraw', async () => {
            const voteValue = '5';

            // Vote for proposal
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                voteValue,
                voter1
            );

            // Get tokens balance
            ((await dao.methods['tokensBalance(uint256)'](proposalId).call({
                from: voter1
            })).toString()).should.equal(toWeiEther(voteValue));
        });
    });

    describe('#withdrawTokens(uint256)', () => {
        let proposalId;
        const duration = '10';

        beforeEach(async () => {
            // Add proposal
            proposalId = await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: duration,
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
        });

        it('should fail if proposal not found', async () => {
            await assertRevert(
                dao.methods['withdrawTokens(uint256)'](unknownId()).call({
                    from: voter1
                }),
                'PROPOSAL_NOT_FOUND'
            );
        });

        it('should fail if sender not voted for proposal', async () => {
            // Rewind Dao time to the end of a voting
            const endDate = dateTimeFromDuration(Number(duration)+1);
            await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

            await assertRevert(
                withdrawTokens(
                    dao,
                    token,
                    proposalId,
                    voter1,
                    '0'
                ),
                'INSUFFICIENT_TOKENS_BALANCE'
            );
        });

        it('should fail if sender voted but revoked his vote', async () => {
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );
            await revokeVote(
                dao,
                proposalId,
                voter1
            );

            // Rewind Dao time to the end of a voting
            const endDate = dateTimeFromDuration(Number(duration)+1);
            await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

            await assertRevert(
                withdrawTokens(
                    dao,
                    token,
                    proposalId,
                    voter1,
                    '0'
                ),
                'INSUFFICIENT_TOKENS_BALANCE'
            );
        });

        it('should fail if proposal not finished', async () => {
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );
            await assertRevert(
                withdrawTokens(
                    dao,
                    token,
                    proposalId,
                    voter1,
                    '5'
                ),
                'PROPOSAL_NOT_FINISHED'
            );
        });

        describe('In a case of the voting success', () => {

            beforeEach(async () => {
                // Fulfill voting (to success result)
                await votingCampaign(dao, proposalId, VoteType.Yes, campaign);

                // Rewind Dao time to the end of a voting
                const endDate = dateTimeFromDuration(Number(duration)+1);
                await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

                // Process
                await processProposal(
                    dao,
                    proposalId,
                    proposalCreator1,
                    VoteType.Yes, 
                    campaign
                );
            });

            it('should widthdraw released tokens', async () => {
                await withdrawTokens(
                    dao,
                    token,
                    proposalId,
                    voter1,
                    campaign.filter(v => v.voter === voter1)[0].votes
                );
            });
        });

        describe('In a case of the voting failure', () => {

            beforeEach(async () => {
                // Fulfill voting (to failure result)
                await votingCampaign(dao, proposalId, VoteType.No, campaign);

                // Rewind Dao time to the end of a voting
                const endDate = dateTimeFromDuration(Number(duration+1));
                await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

                // Process
                await processProposal(
                    dao,
                    proposalId,
                    proposalCreator1,
                    VoteType.No, 
                    campaign
                );
            });
            
            it('should widthdraw released tokens', async () => {
                await withdrawTokens(
                    dao,
                    token,
                    proposalId,
                    voter1,
                    campaign.filter(v => v.voter === voter1)[0].votes
                );
            });
        });

        describe('In a case of expired (not processed) voting', () => {

            beforeEach(async () => {
                // Fulfill voting (to failure result)
                await votingCampaign(dao, proposalId, VoteType.No, campaign);

                // Rewind Dao time to the end of a voting
                const endDate = dateTimeFromDuration(Number(duration+1));
                await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();
            });
            
            it('should widthdraw released tokens', async () => {
                await withdrawTokens(
                    dao,
                    token,
                    proposalId,
                    voter1,
                    campaign.filter(v => v.voter === voter1)[0].votes
                );
            });
        });        
    });

    describe('#getProposal(uint256)', () => {
        let proposalId;
        let proposalConfig;

        beforeEach(async () => {
            proposalConfig = {
                details: 'Change target contract owner',
                proposalType: ProposalType.MethodCall,
                duration: '10',
                value: '0',
                destination: target.address,
                methodName: 'transferOwnership',
                methodParamTypes: ['address'],
                methodParams: [voter1]
            };

            // Add proposal
            proposalId = await addProposal(
                dao,
                proposalCreator1,
                proposalConfig
            );
        });

        it('should fail if proposal not existed', async () => {
            await assertRevert(
                dao.methods['getProposal(uint256)'](unknownId()).call({
                    from: voter1
                }),
                'PROPOSAL_NOT_FOUND'
            );
        });
    
        it('should return a proposal', async () => {
            const proposal = await dao.methods['getProposal(uint256)'](proposalId).call({
                from: voter1
            });
            (proposal.details).should.equal(proposalConfig.details);
            (proposal.proposalType).should.equal(proposalConfig.proposalType.toString());
            (proposal.duration).should.equal(proposalConfig.duration);
            (proposal.end < (Date.now()/1000)*Number(proposalConfig.duration)).should.true;
            (proposal.flags).should.deep.equal([false, false, false]);
            (proposal.txDestination).should.equal(target.address);
            (proposal.txValue).should.equal(proposalConfig.value);
            (proposal.txData).should.equal(buildCallData(
                proposalConfig.methodName, 
                proposalConfig.methodParamTypes,
                proposalConfig.methodParams
            ));
            (proposal.txExecuted).should.equal(false);
            (proposal.txSuccess).should.equal(false);
        });
    });

    describe('#getVote(uint256)', () => {
        let proposalId;

        beforeEach(async () => {
            // Add proposal
            proposalId = await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
        });

        it('should fail if proposal not found', async () => {
            await assertRevert(
                dao.methods['getVote(uint256)'](unknownId()).call({
                    from: voter1
                }),
                'PROPOSAL_NOT_FOUND'
            );
        });

        it('should fail if vote not not been sent', async () => {
            await assertRevert(
                dao.methods['getVote(uint256)'](proposalId).call({
                    from: voter1
                }),
                'VOTE_NOT_FOUND'
            );
        });
    
        it('should return a vote', async () => {
            const value = '5';
            const voteType = VoteType.Yes;
            // Add a vote for proposal
            await doVote(
                dao,
                proposalId,
                voteType,
                value,
                voter1
            );

            const vote = await dao.methods['getVote(uint256)'](proposalId).call({
                from: voter1
            });
            (vote.voteType).should.equal(voteType.toString());
            (vote.valueOriginal).should.equal(toWeiBN(value).toString());
            (vote.valueAccepted).should.equal(isqrt(toWeiBN(value)).toString());
            (vote.revoked).should.equal(false);            
        });
    });

    describe('#getActiveProposalsIds()', () => {

        describe('In a case when proposals has not been added at all', () => {

            it('should return empty array', async () => {
                ((await dao.methods['getActiveProposalsIds()']().call()).length).should.equal(0);
            });
        });

        describe('In a case when registered proposals are exists', () => {
            let proposalId1;
            let proposalId2;

            beforeEach(async () => {
                // Add proposal #1
                proposalId1 = await addProposal(
                    dao,
                    proposalCreator1,
                    {
                        details: 'Change target contract owner',
                        proposalType: ProposalType.MethodCall,
                        duration: '10',
                        value: '0',
                        destination: target.address,
                        methodName: 'transferOwnership',
                        methodParamTypes: ['address'],
                        methodParams: [voter1]
                    }
                );

                // Add proposal #2
                proposalId2 = await addProposal(
                    dao,
                    proposalCreator1,
                    {
                        details: 'Change target contract owner',
                        proposalType: ProposalType.MethodCall,
                        duration: '10',
                        value: '0',
                        destination: target.address,
                        methodName: 'transferOwnership',
                        methodParamTypes: ['address'],
                        methodParams: [voter2]
                    }
                );
            });

            it('should return empty array if all proposals in a passed state', async () => {            
                // Fulfill first voting to success result
                await votingCampaign(dao, proposalId1, VoteType.Yes, campaign);

                // Fulfill second voting to failure result
                await votingCampaign(dao, proposalId2, VoteType.No, campaign);

                // Rewind Dao time to the end of a voting
                const endDate = dateTimeFromDuration(10) + 1;
                await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

                // Process #1
                await processProposal(
                    dao,
                    proposalId1,
                    proposalCreator1,
                    VoteType.Yes, 
                    campaign
                );

                // Process #2
                await processProposal(
                    dao,
                    proposalId2,
                    proposalCreator1,
                    VoteType.No, 
                    campaign
                );

                ((await dao.methods['getActiveProposalsIds()']().call()).length).should.equal(0);
            });
    
            it('should return a proposals Ids array', async () => {
                (await dao.methods['getActiveProposalsIds()']().call()).should.deep.equal(['0', '1']);
            }); 
        });
    });

    describe('#getActiveProposalsIds(uint8)', () => {

        it('should fail if unknown proposal type has been provided', async () => {
            await assertRevert(dao.methods['getActiveProposalsIds(uint8)'](3).call());
        });

        describe('If proposals has not been added at all', () => {

            it('should return empty array', async () => {
                ((await dao.methods['getActiveProposalsIds(uint8)'](ProposalType.ContractUpgrade).call()).length).should.equal(0);
                ((await dao.methods['getActiveProposalsIds(uint8)'](ProposalType.MethodCall).call()).length).should.equal(0);
            });
        });

        describe('If registered proposals are exists', () => {
            let proposalId1;
            let proposalId2;
            let newTarget;

            beforeEach(async () => {
                // Add 2 proposals with two different types
                // Add proposal #1
                proposalId1 = await addProposal(
                    dao,
                    proposalCreator1,
                    {
                        details: 'Change target contract owner',
                        proposalType: ProposalType.MethodCall,
                        duration: '10',
                        value: '0',
                        destination: target.address,
                        methodName: 'transferOwnership',
                        methodParamTypes: ['address'],
                        methodParams: [voter1]
                    }
                );

                newTarget = await ContractForDaoTestsV2.new({
                    from: initialTargetOwner
                });

                // Add proposal #2
                proposalId2 = await addProposal(
                    dao,
                    proposalCreator1,
                    {
                        details: 'Upgrade target to the new version',
                        proposalType: ProposalType.ContractUpgrade,
                        duration: '10',
                        value: '0',
                        destination: target.address,
                        methodName: 'upgradeTo',
                        methodParamTypes: ['address'],
                        methodParams: [newTarget.address]
                    }
                );
            });

            it('should return empty array if all proposals in a passed state', async () => {            
                // Fulfill first voting to success result
                await votingCampaign(dao, proposalId1, VoteType.Yes, campaign);

                // Fulfill second voting to failure result
                await votingCampaign(dao, proposalId2, VoteType.No, campaign);

                // Rewind Dao time to the end of a voting
                const endDate = dateTimeFromDuration(10) + 1;
                await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

                // Process #1
                await processProposal(
                    dao,
                    proposalId1,
                    proposalCreator1,
                    VoteType.Yes, 
                    campaign
                );

                // Process #2
                await processProposal(
                    dao,
                    proposalId2,
                    proposalCreator1,
                    VoteType.No, 
                    campaign
                );

                ((await dao.methods['getActiveProposalsIds(uint8)'](ProposalType.MethodCall).call()).length).should.equal(0);
                ((await dao.methods['getActiveProposalsIds(uint8)'](ProposalType.ContractUpgrade).call()).length).should.equal(0);
            });
    
            it('should return a proposals Ids array', async () => {
                (await dao.methods['getActiveProposalsIds(uint8)'](ProposalType.MethodCall).call()).should.deep.equal(['0']);
                (await dao.methods['getActiveProposalsIds(uint8)'](ProposalType.ContractUpgrade).call()).should.deep.equal(['1']);
            }); 
        });
    });

    describe('#votingResult(uint256)', () => {
        let proposalId;

        beforeEach(async () => {
            // Add proposal
            proposalId = await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
        });

        it('should fail if proposal not found', async () => {
            await assertRevert(
                dao.methods['votingResult(uint256)'](unknownId()).call(),
                'PROPOSAL_NOT_FOUND'
            );
        });

        it('should return 0 and 0 if no votes has beed added', async () => {
            const votingResult = await dao.methods['votingResult(uint256)'](proposalId).call();
            (votingResult.yes).should.equal('0');
            (votingResult.no).should.equal('0');
        });

        it('should return 0 if votes has been added and then revoked', async () => {
            // Add vote
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                '5',
                voter1
            );

            // Revoke previous vote
            await revokeVote(
                dao,
                proposalId,
                voter1
            );

            const votingResult = await dao.methods['votingResult(uint256)'](proposalId).call();
            (votingResult.yes).should.equal('0');
            (votingResult.no).should.equal('0');
        });

        it('should return a voting result', async () => {
            const votesToVote = '5';
            await doVote(
                dao,
                proposalId,
                VoteType.Yes,
                votesToVote,
                voter1
            );
            const votingResult = await dao.methods['votingResult(uint256)'](proposalId).call();
            (votingResult.yes).should.equal(isqrt(toWeiBN(votesToVote)).toString());
        });
    });

    describe('#isVotingPassed(uint256)', () => {
        let proposalId;

        beforeEach(async () => {
            // Add proposal
            proposalId = await addProposal(
                dao,
                proposalCreator1,
                {
                    details: 'Change target contract owner',
                    proposalType: ProposalType.MethodCall,
                    duration: '10',
                    value: '0',
                    destination: target.address,
                    methodName: 'transferOwnership',
                    methodParamTypes: ['address'],
                    methodParams: [voter1]
                }
            );
        });

        it('should fail if proposal not found', async () => {
            await assertRevert(
                dao.methods['isVotingPassed(uint256)'](unknownId()).call(),
                'PROPOSAL_NOT_FOUND'
            );
        });

        it('should return true if proposal passed', async () => {
            // Fulfill voting (to success result)
            await votingCampaign(dao, proposalId, VoteType.Yes, campaign);

            // Rewind Dao time to the end of a voting
            const endDate = dateTimeFromDuration(10) + 1;
            await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

            // Process
            await processProposal(
                dao,
                proposalId,
                proposalCreator1,
                VoteType.Yes, 
                campaign
            );

            // 'passed' state
            (await dao.methods['isVotingPassed(uint256)'](proposalId).call()).should.be.true;
        });

        it('should return false if proposal not passed after voting finished', async () => {
            // Fulfill voting (to success result)
            await votingCampaign(dao, proposalId, VoteType.No, campaign);

            // Rewind Dao time to the end of a voting
            const endDate = dateTimeFromDuration(10) + 1;
            await dao.methods['setCurrentTime(uint256)'](endDate.toString()).send();

            // Process
            await processProposal(
                dao,
                proposalId,
                proposalCreator1,
                VoteType.No, 
                campaign
            );

            // Not 'passed' state
            (await dao.methods['isVotingPassed(uint256)'](proposalId).call()).should.be.false;
        });

        it('should return false if proposal cancelled', async () => {
            await cancelProposal(
                dao,
                proposalId,
                proposalCreator1
            );
            (await dao.methods['isVotingPassed(uint256)'](proposalId).call()).should.be.false;
        });

        it('should return false if voting not finished yet', async () => {
            (await dao.methods['isVotingPassed(uint256)'](proposalId).call()).should.be.false;
        });
    });
});