(function (mw, $) {
    "use strict";

    /**
     * Plugin representing a webcast polls.
     * This class is responsible for the the interaction with the producer (using cue points), the player (using player events) and the user (using dom elements and events).
     */
    mw.PluginManager.add('webcastPolls', mw.KBasePlugin.extend({
        defaultConfig: {
            'userId' : 'User'
        },
        cuePointsManager: null, // manages all the cue points tracking (cue point reached of poll results, poll states etc).
        cachedPollsContent: {}, // used to cache poll results to improve poll warm data loading (load the poll before we actually need to show it.)
        kalturaProxy: null, // manages the communication with the Kaltura api (invoke a vote, extract poll data).
        userProfile: null, // manages active user profile
        userVote: {}, // ## Should remain empty (filled by 'resetPersistData')
        pollData: {}, // ## Should remain empty (filled by 'resetPersistData')
        /* stores all the information that doesn't relate directly to the poll currently selected */
        globals : {
            votingProfileId: null, // used to create a voting cue point (with relevant metadata)
            userId: null, // used to mange user voting (prevent duplication of voting)
            isPollShown: false // indicate if we actually showing a poll (all minimal poll data was retrieved and the poll can be shown)
        },
        /**
         * Resets poll player plugin internals
         */
        resetPersistData: function ()
        {
            var _this = this;
            _this.log('resetting current poll information');

            _this.userVote = {metadataId: null, answer: null, inProgress: false, canUserVote: false, isReady: false, showAnswers :false};
            _this.pollData = {
                pollId : null,
                content: null,
                showResults: false,
                showTotals: false,
                pollResults: null
            };
        },
        /**
         * Bootstrap the plugin upon player loading.
         */
        setup: function () {
            var _this = this;

            // reset parameters
            _this.resetPersistData();

            // register to player events
            _this.addBindings();

            // initialize dependent components
            _this.initializeDependentComponents();

            // ## only if live - fetch information that will assist later with voting
            if (this.embedPlayer.isLive()) {
                // get user id (will be used later when voting or fetching user vote)
                _this.globals.userId = _this.userProfile.getUserID($.proxy(_this.getConfig, _this));
                _this.log("got user id '" + _this.globals.userId + "'  that will be used for voting");

                //  get voting metadata id needed to create user voting
                _this.kalturaProxy.getVoteCustomMetadataProfileId().then(function (result) {
                    _this.log("got voting metadata profile id '" + result.profileId + "', reload current poll user voting (if any)");
                    // got metadata id - store for later use and reload user voting of current poll
                    _this.globals.votingProfileId = result.profileId;

                    _this.reloadPollUserVoting();

                }, function (reason) {
                    // if failed to retrieve metadata id - do nothing
                    _this.log("error while trying to get voting metadata profile id, user will not be able to vote");
                    _this.globals.votingProfileId = null;
                });
            }else
            {
                _this.log("entry is in vod mode - disable voting feature for polls");

            }
        },
        /**
         * Reloads user voting of current poll using the metadata id needed for voting
         */
        reloadPollUserVoting : function()
        {
            var _this = this;
            if (_this.pollData.pollId) {
                var invokedByPollId = _this.pollData.pollId;
                // ## get poll data to show
                _this.getPollUserVote(_this.pollData.pollId, true).then(function (result) {
                    if (invokedByPollId === _this.pollData.pollId) {
                        if (result) {
                            _this.userVote.answer = result.answer;
                            _this.userVote.metadataId = result.metadataId;
                        }

                        _this.view.syncPollDOM();

                        _this.handlePollResultsCuePoints(true);
                    }
                }, function (reason) {
                    if (invokedByPollId === _this.pollData.pollId) {
                        // TODO [es] handle
                    }
                });
            }
        },
        /**
         * Monitor player events and adjust current poll status accordingly
         */
        addBindings: function ()
        {
            // bind to cue point events
            var _this = this;

            this.bind('onpause seeked onplay onChangeMedia', function (e) {
                _this.handlePlayerEvent(e.type);
            });
        },
        /**
         * Filter list of reached cue points to get the most updated poll status cue point
         * @param context
         * @returns {object} the most updated poll status reached cue point if found, otherwise null
         */
        filterStateCuePoints : function(context)
        {
            var _this = this;
            if (context && context.filter && context.cuePoints) {
                var relevantCuePoints = context.filter({
                    tags: ['select-poll-state', 'remove-selected-thumb', 'select-a-thumb'],
                    sortDesc: true
                });

                return relevantCuePoints.length > 0 ? relevantCuePoints[0] : null; // since we ordered the relevant cue points descending - the first cue point is the most updated
            }

            return null;
        },
        /**
         * Filter list of reached cue points to get the most updated poll results cue point of current poll
         * @param context
         * @returns {object} the most updated poll results reached cue point of current poll if found, otherwise null
         */
        filterPollResultsCuePoints : function(context)
        {
            var _this = this;
            if (context && context.filter && context.cuePoints && _this.pollData.pollId) {

                try {
                    var relevantCuePoints = context.filter({
                        tags: ['poll-results'],
                        sortDesc: true,
                        filter : function(cuePoint)
                        {
                            var pollData = JSON.parse(cuePoint.partnerData);
                            return pollData.pollId  === _this.pollData.pollId;
                        }
                    });

                    return relevantCuePoints.length > 0 ? relevantCuePoints[0] : null; // since we ordered the relevant cue points descending - the first cue point is the most updated
                }catch(e)
                {
                    // TODO [es]
                }
            }

            return null;
        },
        /**
         * Changes current poll status according to player events.
         * For example, removing the poll when user pause the player
         * @param eventName the event name invoked by the player.
         * @returns {boolean}
         */
        handlePlayerEvent : function(eventName)
        {
            var _this = this;

            switch(eventName)
            {
                case 'onpause':
                case 'onChangeMedia':
                    _this.log("event '" + eventName + "' triggered - removing current poll (if any)");
                    // remove current poll is found when player is being paused or when changing media (during playlist for example)
                    _this.removePoll();
                    break;
                case 'onplay':
                case 'seeked':
                    if (eventName === 'onplay' || (eventName === 'seeked' && !_this.getPlayer().isPlaying())) {
                        // # we need to sync current poll state when user press playing or seeking.
                        // Note that since onplay is triggered also after seeking to prevent duplicate handling of the sync we will check first if user is in pause mode during the seek
                        _this.log("event '" + eventName + "' - start syncing current poll state");
                        if (_this.cuePointsManager) {
                            var cuePointsReachedArgs = _this.cuePointsManager.getCuePointsReached();
                            _this.handleStateCuePoints(true);
                            _this.handlePollResultsCuePoints(true);
                        }
                        _this.log("event '" + eventName + "' - done syncing current poll state");
                    }
                    break;
                default:
                    break;
            }
        },
        /**
         * Initializes required dependent components used by the polls plugin 
         */
        initializeDependentComponents: function ()
        {
            var _this = this;

            if (!_this.userProfile) {
                // user profile component used to provide current user id needed for voting.
                _this.userProfile = new mw.webcast.UserProfile(_this.getPlayer(), function () {
                }, "webcastPollsUserProfile");
            }

            if (!_this.kalturaProxy) {
                // kaltura api proxy used to communicate with the kaltura api (transmit voting, fetch poll data etc)
                _this.kalturaProxy = new mw.webcastPolls.WebcastPollsKalturaProxy(_this.getPlayer(), function () {
                }, "webcastPollsKalturaProxy");
            }

            if (!_this.view) {
                // initialize component that manages the interactions with polls DOM elements.
                _this.view = new mw.webcastPolls.WebcastPollsView(_this.getPlayer(), function () {
                }, "webcastPollsKalturaView");
                _this.view.parent = _this;
            }

            if (!_this.cuePointsManager) {
                // cue points manager used to monitor and notify when relevant cue points reached (polls status, results).
                _this.cuePointsManager = new mw.webcast.CuePointsManager(_this.getPlayer(), function () {
                }, "webcastPollsCuePointsManager");

                _this.cuePointsManager.onCuePointsReached = $.proxy(function(args)
                {
                    // new cue points reached - change internal polls status when relevant cue points reached
                    _this.handleStateCuePoints(args);
                    _this.handlePollResultsCuePoints(args);
                },_this);
            }
        },
        /**
         * Modifies current poll results according to cue points reached.
         * This function searches for relevant cue points and if found changes current poll results
         * @param args arguments provided by cue points manager with support for smart cue points filtering OR value 'true' to handle reset mode
         */
        handlePollResultsCuePoints: function (args)
        {
            var _this = this;
            var resetMode = false;
            var cuePointArgs = args;

            if ($.type(args) === 'boolean' )
            {
                if (args) {
                    _this.log("handling reset mode for poll results");
                    // # we should check all reached cue points and treat this scenario as reset (meaning if no cue points found should remove previous polls results)
                    resetMode = true;
                    cuePointArgs = _this.cuePointsManager.getCuePointsReached();
                }else
                {
                    return;
                }
            }

            if (_this.pollData.showResults || _this.pollData.showTotals)
            {
                // according to poll state should show poll results or totals
                var pollResultsCuePoint = _this.filterPollResultsCuePoints(cuePointArgs);
                if (pollResultsCuePoint && pollResultsCuePoint.partnerData) {
                    try {
                        _this.log("found poll results for current poll - syncing poll results");
                        var pollResults = JSON.parse(pollResultsCuePoint.partnerData);
                        _this.pollData.pollResults = pollResults;
                    } catch (e) {
                        _this.log("invalid poll results structure - ignoring current result");
                        _this.pollData.pollResults = null;
                    }

                }else {
                    if (resetMode) {
                        _this.log("reset mode - didn't find any relevant poll results, removing current poll results (if any)");
                        // in reset mode if we didn't find any relevant poll results we should assume current poll has not results
                        _this.pollData.pollResults = null;
                    }
                }
            }else
            {
                _this.log("poll state request to hide results and total voters - hiding poll results (if any)");
                // according to poll state should hide poll results
                _this.pollData.pollResults = null;
            }

            _this.view.syncDOMPollResults();
        },
        /**
         * Modifies current poll status according to cue points reached.
         * This function searches for relevant cue points and if found changes current poll status
         * @param args arguments provided by cue points manager with support for smart cue points filtering  OR value 'true' to handle reset mode
         */
        handleStateCuePoints: function (args)
        {
            var _this = this;
            var resetMode = false;
            var cuePointArgs = args;

            if ($.type(args) === 'boolean')
            {
                // # we should check all reached cue points and treat this scenario as reset (meaning if no cue points found should remove previous polls results)
                if (args) {
                    _this.log("handling reset mode for poll state");
                    resetMode = true;
                    cuePointArgs = _this.cuePointsManager.getCuePointsReached();
                }else
                {
                    return;
                }
            }

            var stateCuePointToHandle = _this.filterStateCuePoints(cuePointArgs);
            if (stateCuePointToHandle) {
                try {
                    var showingAPoll = stateCuePointToHandle.tags.indexOf('select-poll-state') > -1;

                    if (showingAPoll) {
                        _this.log("found an update for poll - syncing current poll with state '" + stateCuePointToHandle.partnerData + "'");

                        var pollState = JSON.parse(stateCuePointToHandle.partnerData);

                        if (pollState) {
                            _this.showOrUpdatePollByState(pollState);
                        }
                    } else {
                        _this.log("found an update for currently shown asset which is not of type poll, remove current poll (if any)");
                        _this.removePoll();
                    }
                } catch (e) {
                    // TODO [es]
                }

            }else {
                if (resetMode) {
                    _this.log("reset mode - didn't find any relevant poll state, removing current poll (if any)");
                    // in reset mode if we didn't find any relevant poll we should remove the current one
                    _this.removePoll();
                }
            }

            return !!stateCuePointToHandle;
        },
        /**
         * Removes currently shown poll (if any) from the view and reset polls plugin information
         */
        removePoll: function ()
        {
            var _this = this;
            _this.log("removing currently shown poll (if any)")

            if (_this.globals.isPollShown) {
                _this.view.removeWebcastPollElement();
                _this.globals.isPollShown = false;
            }

            // ## IMPORTANT: perform cleanup of information that was relevant to previous poll
            _this.resetPersistData();
        },
        /**
         * Update currently shown poll state according to poll state information
         * @param pollState poll state context information
         */
        showOrUpdatePollByState: function (pollState)
        {
            var _this = this;

            if (!pollState || !pollState.pollId) {
                // ignore empty poll state context
                return;
            }

            try {
                var isShowingRequestedPoll = _this.pollData.pollId === pollState.pollId; // flag indicating if currently shown the requested poll.
                var pollElement = _this.view.getWebcastPollElement(); // requesting a poll element to be sure it exists

                if (pollElement) {
                    _this.log("handling update state for poll '" + pollState.pollId + "' (currently showing poll '" + _this.pollData.pollId + "')");
                    if (!isShowingRequestedPoll) {
                        // ## prepare component internals to new poll
                        _this.resetPersistData();

                        // ## update internals
                        _this.globals.isPollShown = true;
                        _this.pollData.pollId = pollState.pollId;
                    }

                    // sync internals with poll status
                    _this.userVote.canUserVote = pollState.status === 'inProgress';
                    _this.pollData.showAnswers = pollState.showAnswers;
                    _this.pollData.showTotals = pollState.showTotals && pollState.showTotals !== 'disabled';
                    _this.pollData.showResults = pollState.showResults && pollState.showResults !== 'disabled';

                    if (!isShowingRequestedPoll)
                    {
                        // ## show the poll the first time & extract important information

                        var invokedByPollId = _this.pollData.pollId;

                        // ## get poll data to show
                        var pollContentPromise = _this.getPollContent(invokedByPollId, true);
                        var pollUserVotePromise = _this.globals.votingProfileId ? _this.getPollUserVote(invokedByPollId, true) : null;

                        $.when(pollContentPromise, pollUserVotePromise).then(function (pollContentResult, pollUserVoteResult) {
                            if (invokedByPollId === _this.pollData.pollId) {
                                _this.pollData.content = pollContentResult;
                                _this.userVote.isReady = true;

                                if (pollUserVoteResult) {
                                    _this.userVote.answer = pollUserVoteResult.answer;
                                    _this.userVote.metadataId = pollUserVoteResult.metadataId;
                                }

                                _this.view.syncPollDOM();

                                _this.handlePollResultsCuePoints(true); // update currently shown poll results (if required)
                            }
                        }, function (reason) {
                            if (invokedByPollId === _this.pollData.pollId) {
                                // TODO [es] handle
                            }
                        });

                        // make sure we update the view with the new poll
                        _this.view.syncPollDOM();
                    } else {
                        // ## update current poll with voting and results according to poll status.
                        _this.view.syncDOMAnswersVisibility();
                        _this.view.syncDOMUserVoting();
                        _this.view.syncDOMPollResults();
                    }
                }else{
                    // has nothing to do if poll dom element not created
                }
            } catch (e) {
                // todo [es] handle
            }
        },
        /**
         * Gets poll user vote (either from kaltura api or from cache)
         * @param pollId pollId to get user vote for
         * @param forceGet whether to force get from kaltura api
         * @returns {*} a promise with user vote information
         */
        getPollUserVote : function(pollId, forceGet)
        {
            var _this = this;
            var defer = $.Deferred();

            if (this.embedPlayer.isLive()) {
                var cachedPollItem = _this.cachedPollsContent[pollId] = (_this.cachedPollsContent[pollId] || {});

                if (forceGet || !cachedPollItem.userVote) {
                    if (_this.globals.votingProfileId) {
                        _this.kalturaProxy.getUserVote(pollId, _this.globals.votingProfileId, _this.globals.userId).then(function (result) {
                            cachedPollItem.userVote = result;
                            defer.resolve(cachedPollItem.userVote);
                            _this.log("getting poll '" + pollId + "' user vote from kaltura api");
                        }, function () {
                            cachedPollItem.userVote = null;
                            defer.reject();
                        });
                    } else {
                        defer.reject();
                    }
                } else {
                    defer.resolve(cachedPollItem.userVote);
                    _this.log("getting poll '" + pollId + "' user vote from cache");

                }
            }else {
                _this.log("request for getting poll user vote is not relevant during vod mode");
                defer.reject({});
            }

            return defer.promise();
        },
        /**
         * Gets poll content (either from kaltura api or from cache)
         * @param pollId
         * @param forceGet
         * @returns {*}
         */
        getPollContent: function (pollId, forceGet) {
            var _this = this;
            var defer = $.Deferred();

            var cachedPollItem = _this.cachedPollsContent[pollId] = (_this.cachedPollsContent[pollId] || {});

            if (forceGet || !cachedPollItem.pollContent) {

                _this.kalturaProxy.getPollContent(pollId).then(function (result) {
                    cachedPollItem.pollContent = result;
                    defer.resolve(cachedPollItem.pollContent);
                    _this.log("getting poll '" + pollId + "' content from kaltura api");
                }, function () {
                    cachedPollItem.pollContent = null;
                    defer.reject();
                });
            } else {
                defer.resolve(cachedPollItem.pollContent);
                _this.log("getting poll '" + pollId + "' content from cache");


            }

            return defer.promise();
        },
        /**
         * Indicates if a user can vote
         * @returns {*|null|boolean} true if the user can vote, false otherwise
         */
        canUserVote: function ()
        {
            var _this = this;
            return this.embedPlayer.isLive() && _this.pollData.pollId && _this.globals.votingProfileId && !_this.userVote.inProgress && _this.userVote.canUserVote && _this.userVote.isReady;
        },
        /**
         * handle answer clicked by user
         * @param e
         */
        handleAnswerClicked: function (e)
        {
            var _this = this;

            if (!_this.canUserVote()) {
                _this.log('user cannot vote at the moment - ignoring request');
                return;
            }

            var previousAnswer = _this.userVote.answer;

            try {
                var selectedAnswer = $(e.currentTarget).find("[data-poll-value]").data('poll-value'); // get selected answer by user

                if (isNaN(selectedAnswer))
                {
                    _this.log('failed to get the answer identifier for user selected answer - ignoring request');
                    return;

                }

                if (_this.userVote.answer === selectedAnswer) {
                    _this.log('user tried to vote to currently selected answer - ignoring request');
                    return;
                }

                _this.log('transmitting user vote for answer ' + selectedAnswer);
                _this.userVote.inProgress = true;
                _this.userVote.answer = selectedAnswer;
                _this.view.syncDOMUserVoting();

                if (_this.userVote.metadataId) {
                    _this.log('user already voted for this poll, update user vote');
                    var invokedByPollId = _this.pollData.pollId;
                    _this.kalturaProxy.transmitVoteUpdate(_this.userVote.metadataId, _this.globals.userId, selectedAnswer).then(function (result) {
                        if (invokedByPollId === _this.pollData.pollId) {
                            _this.log('successfully updated server with user answer');
                            _this.userVote.inProgress = false;
                            _this.view.syncDOMUserVoting();
                        }

                    }, function (reason) {
                        if (invokedByPollId === _this.pollData.pollId) {
                            _this.log('error occurred while updating server with user answer - undo to previously selected answer (if any)');
                            _this.userVote.inProgress = false;
                            _this.userVote.answer = previousAnswer;
                            _this.view.syncDOMUserVoting();
                        }
                    });
                } else {
                    _this.log("user didn't vote yet in this poll, update user vote");
                    var invokedByPollId = _this.pollData.pollId;
                    _this.kalturaProxy.transmitNewVote(_this.pollData.pollId, _this.globals.votingProfileId, _this.globals.userId, selectedAnswer).then(function (result) {
                        if (invokedByPollId === _this.pollData.pollId) {
                            _this.log('successfully updated server with user vote');
                            _this.userVote.inProgress = false;
                            _this.userVote.metadataId = result.metadataId;
                            _this.view.syncDOMUserVoting();
                        }

                    }, function (reason) {
                        if (invokedByPollId === _this.pollData.pollId) {
                            _this.log('error occurred while updating server with user answer - undo to previously selected answer (if any)');
                            _this.userVote.inProgress = false;
                            _this.userVote.answer = previousAnswer;
                            _this.view.syncDOMUserVoting();
                        }
                    });
                }
            } catch (e) {
                _this.log('failed to get update user vote in kaltura server - undo to previously selected answer (if any)');
                _this.userVote.inProgress = false;
                _this.userVote.answer = previousAnswer;
                _this.view.syncDOMUserVoting();

            }

        }
    }));

})(window.mw, window.jQuery);

