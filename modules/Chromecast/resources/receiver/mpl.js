var senders = {};  // a list of Chrome senders
var maxBW = null;  // maximum bandwidth
var videoStreamIndex = -1;  // index for video stream
var audioStreamIndex = -1;  // index for audio stream
var licenseUrl = null;  // license server URL
var videoQualityIndex = -1;  // index for video quality level
var audioQualityIndex = -1;  // index for audio quality level
var manifestCredentials = false;  // a flag to indicate manifest credentials
var segmentCredentials = false;  // a flag to indicate segment credentials
var licenseCredentials = false;  // a flag to indicate license credentials
var streamVideoBitrates;  // bitrates of video stream selected
var streamAudioBitrates;  // bitrates of audio stream selected

var castReceiverManager = null; // an instance of cast.receiver.CastReceiverManager
var mediaManager = null;  // an instance of cast.receiver.MediaManager
var messageBus = null;  // custom message bus
var mediaElement = null;  // media element
var mediaHost = null;  // an instance of cast.player.api.Host
var mediaProtocol = null;  // an instance of cast.player.api.Protocol
var mediaPlayer = null;  // an instance of cast.player.api.Player
var playerInitialized = false;
var isInSequence = false;
var debugMode = true;
var kdp;


onload = function () {
	if (debugMode){
		cast.receiver.logger.setLevelValue(cast.receiver.LoggerLevel.DEBUG);
		cast.player.api.setLoggerLevel(cast.player.api.LoggerLevel.DEBUG);
	}

	mediaElement = document.getElementById('receiverVideoElement');
	mediaElement.autoplay = true;

	//setMediaElementEvents(mediaElement);
	mediaManager = new cast.receiver.MediaManager(mediaElement);
	setMediaManagerEvents();
	castReceiverManager = cast.receiver.CastReceiverManager.getInstance();
	messageBus = castReceiverManager.getCastMessageBus('urn:x-cast:com.kaltura.cast.player');

	setCastReceiverManagerEvents();
	setTimeout(function(){
		initApp();
	},5000);

	messageBus.onMessage = function (event) {
		console.log('### Message Bus - Media Message: ' + JSON.stringify(event));
		setDebugMessage('messageBusMessage', event);

		console.log('### CUSTOM MESSAGE: ' + JSON.stringify(event));
		// show/hide messages
		console.log(event['data']);
		var payload = JSON.parse(event['data']);
		if (payload['type'] === 'show') {
			if (payload['target'] === 'debug') {
				document.getElementById('messages').style.display = 'block';
			}
			if (payload['target'] === 'logo') {
				document.getElementById('logo').style.display = 'block';
			} else {
				document.getElementById('receiverVideoElement').style.display = 'block';
			}
		} else if (payload['type'] === 'hide') {
			if (payload['target'] === 'debug') {
				document.getElementById('messages').style.display = 'none';
			}
			if (payload['target'] === 'logo') {
				var logoElement =  document.getElementById('logo');
				logoElement.style.opacity = 0;
				setTimeout(function() {
					logoElement.style.display = 'none';
				},1000);
			} else {
				document.getElementById('receiverVideoElement').style.display = 'none';
			}
		} else if (payload['type'] === 'ENABLE_CC') {
			var trackNumber = payload['trackNumber'];
			setCaption(trackNumber);
		} else if (payload['type'] === 'WebVTT') {
			mediaPlayer.enableCaptions(false);
			mediaPlayer.enableCaptions(true, 'webvtt', 'captions.vtt');
		} else if (payload['type'] === 'TTML') {
			mediaPlayer.enableCaptions(false);
			mediaPlayer.enableCaptions(true, 'ttml', 'captions.ttml');
		} else if (payload['type'] === 'maxBW') {
			maxBW = payload['value'];
		} else if (payload['type'] === 'license') {
			licenseUrl = payload['value'];
			setDebugMessage('licenseUrl', licenseUrl);
		} else if (payload['type'] === 'qualityIndex' &&
			payload['mediaType'] === 'video') {
			videoQualityIndex = payload['value'];
			setDebugMessage('videoQualityIndex', videoQualityIndex);
		} else if (payload['type'] === 'qualityIndex' &&
			payload['mediaType'] === 'audio') {
			audioQualityIndex = payload['value'];
			setDebugMessage('audioQualityIndex', audioQualityIndex);
		} else if (payload['type'] === 'manifestCredentials') {
			manifestCredentials = payload['value'];
			setDebugMessage('manifestCredentials', manifestCredentials);
		} else if (payload['type'] === 'segmentCredentials') {
			segmentCredentials = payload['value'];
			setDebugMessage('segmentCredentials', segmentCredentials);
		} else if (payload['type'] === 'licenseCredentials') {
			licenseCredentials = payload['value'];
			setDebugMessage('licenseCredentials', licenseCredentials);
		} else if (payload['type'] === 'customData') {
			customData = payload['value'];
			setDebugMessage('customData', customData);
		} else if (payload['type'] === 'load') {
			//setMediaManagerEvents();
		} else if (payload['type'] === 'notification') {
			kdp.sendNotification(payload['event'], [payload['data']]); // pass notification event to the player
		} else if (payload['type'] === 'setLogo') {
			document.getElementById('logo').style.backgroundImage = "url(" + payload['logo'] + ")";
		} else if (payload['type'] === 'changeMedia') {
			kdp.sendNotification('changeMedia', {"entryId": payload['entryId']});
		} else {
			licenseUrl = null;
		}
		// broadcast(event['data']);
	};


};
function setMediaManagerEvents() {
	/**
	 * Called when the media ends.
	 *
	 * mediaManager.resetMediaElement(cast.receiver.media.IdleReason.FINISHED);
	 **/
	mediaManager['onEndedOrig'] = mediaManager.onEnded;
	/**
	 * Called when the media ends
	 */
	mediaManager.onEnded = function () {
		setDebugMessage('mediaManagerMessage', 'ENDED');
		if (!isInSequence){
			mediaManager['onEndedOrig']();
		}
	};

	/**
	 * Default implementation of onError.
	 *
	 * mediaManager.resetMediaElement(cast.receiver.media.IdleReason.ERROR)
	 **/
	mediaManager['onErrorOrig'] = mediaManager.onError;
	/**
	 * Called when there is an error not triggered by a LOAD request
	 * @param {Object} obj An error object from callback
	 */
	mediaManager.onError = function (obj) {
		setDebugMessage('mediaManagerMessage', 'ERROR - ' + JSON.stringify(obj));

		mediaManager['onErrorOrig'](obj);
		if (mediaPlayer) {
			mediaPlayer.unload();
			mediaPlayer = null;
		}
	};

	/**
	 * Processes the get status event.
	 *
	 * Sends a media status message to the requesting sender (event.data.requestId)
	 **/
	mediaManager['onGetStatusOrig'] = mediaManager.onGetStatus;
	/**
	 * Processes the get status event.
	 * @param {Object} event An status object
	 */
	mediaManager.onGetStatus = function (event) {
		console.log('### Media Manager - GET STATUS: ' + JSON.stringify(event));
		setDebugMessage('mediaManagerMessage', 'GET STATUS ' +
			JSON.stringify(event));

		mediaManager['onGetStatusOrig'](event);
	};

	/**
	 * Default implementation of onLoadMetadataError.
	 *
	 * mediaManager.resetMediaElement(cast.receiver.media.IdleReason.ERROR, false);
	 * mediaManager.sendLoadError(cast.receiver.media.ErrorType.LOAD_FAILED);
	 **/
	mediaManager['onLoadMetadataErrorOrig'] = mediaManager.onLoadMetadataError;
	/**
	 * Called when load has had an error, overridden to handle application
	 * specific logic.
	 * @param {Object} event An object from callback
	 */
	mediaManager.onLoadMetadataError = function (event) {
		console.log('### Media Manager - LOAD METADATA ERROR: ' +
			JSON.stringify(event));
		setDebugMessage('mediaManagerMessage', 'LOAD METADATA ERROR: ' +
			JSON.stringify(event));

		mediaManager['onLoadMetadataErrorOrig'](event);
	};

	/**
	 * Default implementation of onMetadataLoaded
	 *
	 * Passed a cast.receiver.MediaManager.LoadInfo event object
	 * Sets the mediaElement.currentTime = loadInfo.message.currentTime
	 * Sends the new status after a LOAD message has been completed succesfully.
	 * Note: Applications do not normally need to call this API.
	 * When the application overrides onLoad, it may need to manually declare that
	 * the LOAD request was sucessful. The default implementaion will send the new
	 * status to the sender when the video/audio element raises the
	 * 'loadedmetadata' event.
	 * The default behavior may not be acceptable in a couple scenarios:
	 *
	 * 1) When the application does not want to declare LOAD succesful until for
	 *    example 'canPlay' is raised (instead of 'loadedmetadata').
	 * 2) When the application is not actually loading the media element (for
	 *    example if LOAD is used to load an image).
	 **/
	mediaManager['onLoadMetadataOrig'] = mediaManager.onLoadMetadataLoaded;
	/**
	 * Called when load has completed, overridden to handle application specific
	 * logic.
	 * @param {Object} event An object from callback
	 */
	mediaManager.onLoadMetadataLoaded = function (event) {
		console.log('### Media Manager - LOADED METADATA: ' +
			JSON.stringify(event));
		setDebugMessage('mediaManagerMessage', 'LOADED METADATA: ' +
			JSON.stringify(event));
		mediaManager['onLoadMetadataOrig'](event);
	};

	/**
	 * Processes the pause event.
	 *
	 * mediaElement.pause();
	 * Broadcast (without sending media information) to all senders that pause has
	 * happened.
	 **/
	mediaManager['onPauseOrig'] = mediaManager.onPause;
	/**
	 * Process pause event
	 * @param {Object} event
	 */
	mediaManager.onPause = function (event) {
		console.log('### Media Manager - PAUSE: ' + JSON.stringify(event));
		setDebugMessage('mediaManagerMessage', 'PAUSE: ' + JSON.stringify(event));
		mediaManager['onPauseOrig'](event);
	};

	/**
	 * Default - Processes the play event.
	 *
	 * mediaElement.play();
	 *
	 **/
	mediaManager['onPlayOrig'] = mediaManager.onPlay;
	/**
	 * Process play event
	 * @param {Object} event
	 */
	mediaManager.onPlay = function (event) {
		console.log('### Media Manager - PLAY: ' + JSON.stringify(event));
		setDebugMessage('mediaManagerMessage', 'PLAY: ' + JSON.stringify(event));

		mediaManager['onPlayOrig'](event);
	};

	/**
	 * Default implementation of the seek event.
	 * Sets the mediaElement.currentTime to event.data.currentTime. If the
	 * event.data.resumeState is cast.receiver.media.SeekResumeState.PLAYBACK_START
	 * and the mediaElement is paused then call mediaElement.play(). Otherwise if
	 * event.data.resumeState is cast.receiver.media.SeekResumeState.PLAYBACK_PAUSE
	 * and the mediaElement is not paused, call mediaElement.pause().
	 * Broadcast (without sending media information) to all senders that seek has
	 * happened.
	 **/
	mediaManager['onSeekOrig'] = mediaManager.onSeek;
	/**
	 * Process seek event
	 * @param {Object} event
	 */
	mediaManager.onSeek = function (event) {
		console.log('### Media Manager - SEEK: ' + JSON.stringify(event));
		setDebugMessage('mediaManagerMessage', 'SEEK: ' + JSON.stringify(event));

		mediaManager['onSeekOrig'](event);
	};

	/**
	 * Default implementation of the set volume event.
	 * Checks event.data.volume.level is defined and sets the mediaElement.volume
	 * to the value.
	 * Checks event.data.volume.muted is defined and sets the mediaElement.muted
	 * to the value.
	 * Broadcasts (without sending media information) to all senders that the
	 * volume has changed.
	 **/
	mediaManager['onSetVolumeOrig'] = mediaManager.onSetVolume;
	/**
	 * Process set volume event
	 * @param {Object} event
	 */
	mediaManager.onSetVolume = function (event) {
		console.log('### Media Manager - SET VOLUME: ' + JSON.stringify(event));
		setDebugMessage('mediaManagerMessage', 'SET VOLUME: ' +
			JSON.stringify(event));

		mediaManager['onSetVolumeOrig'](event);
	};

	/**
	 * Processes the stop event.
	 *
	 * mediaManager.resetMediaElement(cast.receiver.media.IdleReason.CANCELLED,
	 *   true, event.data.requestId);
	 *
	 * Resets Media Element to IDLE state. After this call the mediaElement
	 * properties will change, paused will be true, currentTime will be zero and
	 * the src attribute will be empty. This only needs to be manually called if
	 * the developer wants to override the default behavior of onError, onStop or
	 * onEnded, for example.
	 **/
	mediaManager['onStopOrig'] = mediaManager.onStop;
	/**
	 * Process stop event
	 * @param {Object} event
	 */
	mediaManager.onStop = function (event) {
		console.log('### Media Manager - STOP: ' + JSON.stringify(event));
		setDebugMessage('mediaManagerMessage', 'STOP: ' + JSON.stringify(event));

		mediaManager['onStopOrig'](event);
	};

	/**
	 * Default implementation for the load event.
	 *
	 * Sets the mediaElement.autoplay to false.
	 * Checks that data.media and data.media.contentId are valid then sets the
	 * mediaElement.src to the data.media.contentId.
	 *
	 * Checks the data.autoplay value:
	 *   - if undefined sets mediaElement.autoplay = true
	 *   - if has value then sets mediaElement.autoplay to that value
	 **/
	mediaManager['onLoadOrig'] = mediaManager.onLoad;
	/**
	 * Processes the load event.
	 * @param {Object} event
	 */
	mediaManager.onLoad = function (event) {
		var embedInfo = event.data.media.customData;
		messageBus.broadcast("mediaManager.onLoad");
		console.log('### Media Manager - LOAD: ' + JSON.stringify(event));
		setDebugMessage('mediaManagerMessage', 'LOAD ' + JSON.stringify(event));


		if (!playerInitialized) {


			var playerLib = embedInfo["lib"] + "mwEmbedLoader.php";
			var s = document.createElement("script");
			s.type = "text/javascript";
			s.src = playerLib;
			document.head.appendChild(s);

			var intervalID = setInterval(function () {
				if (typeof mw !== "undefined") {
					clearInterval(intervalID);
					mw.setConfig("EmbedPlayer.HidePosterOnStart", true);
					if (embedInfo['debugKalturaPlayer'] == true) {
						mw.setConfig("debug", true);
						mw.setConfig("debugTarget", "kdebug");
						//mw.setConfig("debugFilter", "---");
						mw.setConfig("autoScrollDebugTarget", true);
						document.getElementById('kdebug').style.display = 'block';
					}
					mw.setConfig("chromecastReceiver", true);
					mw.setConfig("Kaltura.ExcludedModules", "chromecast");

					kWidget.embed({
						"targetId": "kaltura_player",
						"wid": "_" + embedInfo['publisherID'],
						"uiconf_id": embedInfo['uiconfID'],
						"readyCallback": function (playerId) {
							if (!playerInitialized) {
								playerInitialized = true;
								kdp = document.getElementById(playerId);
								$("#receiverVideoElement").remove();
								mediaElement = $(kdp).contents().contents().find("video")[0];
								mediaManager.setMediaElement(mediaElement);
								messageBus.broadcast("mediaHostState: success");
								setDebugMessage('mediaHostState', 'success');

								kdp.kBind("broadcastToSender", function (msg) {
									messageBus.broadcast(msg);
									isInSequence = ( msg == "chromecastReceiverAdOpen" );
								});
							}
						},
						"flashvars": embedInfo['flashVars'],
						"entry_id": embedInfo['entryID']
					});
				}
			}, 100);
		}
		//if (event.data['media'] && event.data['media']['contentId']) {
		//	initPlayer(event);
		//}
	};
}

function initApp() {
	console.log('### Application Loaded. Starting system.');
	setDebugMessage('applicationState', 'Loaded. Starting up.');

	/**
	 * Application config
	 **/
	var appConfig = new cast.receiver.CastReceiverManager.Config();

	/**
	 * Text that represents the application status. It should meet
	 * internationalization rules as may be displayed by the sender application.
	 * @type {string|undefined}
	 **/
	appConfig.statusText = 'Ready to play';

	/**
	 * Maximum time in seconds before closing an idle
	 * sender connection. Setting this value enables a heartbeat message to keep
	 * the connection alive. Used to detect unresponsive senders faster than
	 * typical TCP timeouts. The minimum value is 5 seconds, there is no upper
	 * bound enforced but practically it's minutes before platform TCP timeouts
	 * come into play. Default value is 10 seconds.
	 * @type {number|undefined}
	 * 10 minutes for testing, use default 10sec in prod by not setting this value
	 **/
	appConfig.maxInactivity = 600;
	castReceiverManager.onShutdown = function(){
		messageBus.broadcast("shutdown"); // receiver was shut down by the browser Chromecast icon - send message to the player to stop the app
	}
	/**
	 * Initializes the system manager. The application should call this method when
	 * it is ready to start receiving messages, typically after registering
	 * to listen for the events it is interested on.
	 */
	castReceiverManager.start(appConfig);
}

function setCaption(trackNumber) {
	var current, next;
	if (protocol) {
		var streamCount = protocol.getStreamCount();
		var streamInfo;
		for ( current = 0 ; current < streamCount ; current++ ) {
			if ( protocol.isStreamEnabled( current ) ) {
				streamInfo = protocol.getStreamInfo( current );
				if ( streamInfo.mimeType.indexOf( 'text' ) === 0 ) {
					protocol.enableStream( current , false );
					mediaPlayer.enableCaptions( false );
					break;
				}
			}
		}
		if ( trackNumber ) {
			protocol.enableStream( trackNumber , true );
			mediaPlayer.enableCaptions( true );
		}
	}
}

function nextCaption() {
	var current, next;
	if (protocol) {
		var streamCount = protocol.getStreamCount();
		var streamInfo;
		for ( current = 0 ; current < streamCount ; current++ ) {
			if ( protocol.isStreamEnabled( current ) ) {
				streamInfo = protocol.getStreamInfo( current );
				if ( streamInfo.mimeType.indexOf( 'text' ) === 0 ) {
					break;
				}
			}
		}

		if ( current === streamCount ) {
			next = 0;
		} else {
			next = current + 1;
		}

		while ( next !== current ) {
			if ( next === streamCount ) {
				next = 0;
			}

			streamInfo = protocol.getStreamInfo( next );
			if ( streamInfo.mimeType.indexOf( 'text' ) === 0 ) {
				break;
			}

			next++;
		}

		if ( next !== current ) {
			if ( current !== streamCount ) {
				protocol.enableStream( current , false );
				mediaPlayer.enableCaptions( false );
			}

			if ( next !== streamCount ) {
				protocol.enableStream( next , true );
				mediaPlayer.enableCaptions( true );
			}
		}
	}
}

function setCastReceiverManagerEvents() {
	castReceiverManager.onReady = function (event) {
		console.log('### Cast Receiver Manager is READY: ' + JSON.stringify(event));
		setDebugMessage('castReceiverManagerMessage', 'READY: ' +
			JSON.stringify(event));
		setDebugMessage('applicationState', 'Loaded. Started. Ready.');
	};

	castReceiverManager.onSenderConnected = function (event) {
		console.log('### Cast Receiver Manager - Sender Connected : ' +
			JSON.stringify(event));
		setDebugMessage('castReceiverManagerMessage', 'Sender Connected: ' +
			JSON.stringify(event));

		senders = castReceiverManager.getSenders();
		setDebugMessage('senderCount', '' + senders.length);
	};

	castReceiverManager.onSenderDisconnected = function (event) {
		console.log('### Cast Receiver Manager - Sender Disconnected : ' +
			JSON.stringify(event));
		setDebugMessage('castReceiverManagerMessage', 'Sender Disconnected: ' +
			JSON.stringify(event));

		senders = castReceiverManager.getSenders();
		setDebugMessage('senderCount', '' + senders.length);
	};

	castReceiverManager.onSystemVolumeChanged = function (event) {
		console.log('### Cast Receiver Manager - System Volume Changed : ' +
			JSON.stringify(event));
		setDebugMessage('castReceiverManagerMessage', 'System Volume Changed: ' +
			JSON.stringify(event));

		// See cast.receiver.media.Volume
		console.log('### Volume: ' + event.data['level'] + ' is muted? ' +
			event.data['muted']);
		setDebugMessage('volumeMessage', 'Level: ' + event.data['level'] +
			' -- muted? ' + event.data['muted']);
	};
}

function setMediaElementEvents(mediaElement) {
	mediaElement.addEventListener('loadstart', function (e) {
		kdp.sendNotification("loadstart");
		document.getElementById("kaltura_player").style.visibility = "visible";
		console.log('######### MEDIA ELEMENT LOAD START');
		setDebugMessage('mediaElementState', 'Load Start');
		messageBus.broadcast("mediaElement: Load Start");

	});
	mediaElement.addEventListener('loadeddata', function (e) {
		if (protocol === undefined || protocol === null){
			return;
		}
		console.log('######### MEDIA ELEMENT DATA LOADED');
		setDebugMessage('mediaElementState', 'Data Loaded');
		messageBus.broadcast("mediaElement:Data Loaded");
		var streamCount = protocol.getStreamCount();
		var streamInfo;
		var streamVideoCodecs;
		var streamAudioCodecs;
		var captions = {};
		for (var c = 0; c < streamCount; c++) {
			streamInfo = protocol.getStreamInfo(c);
			if (streamInfo.mimeType.indexOf('text') === 0) {
				captions[c] = streamInfo.language;
			} else if (streamInfo.mimeType === 'video/mp4' ||
				streamInfo.mimeType === 'video/mp2t') {
				streamVideoCodecs = streamInfo.codecs;
				streamVideoBitrates = streamInfo.bitrates;
				if (maxBW) {
					var videoLevel = protocol.getQualityLevel(c, maxBW);
				}
				else {
					var videoLevel = protocol.getQualityLevel(c);
				}
				setDebugMessage('streamVideoQuality', streamInfo.bitrates[videoLevel]);
				videoStreamIndex = c;
				setDebugMessage('videoStreamIndex', videoStreamIndex);
			} else if (streamInfo.mimeType === 'audio/mp4') {
				audioStreamIndex = c;
				setDebugMessage('audioStreamIndex', audioStreamIndex);
				streamAudioCodecs = streamInfo.codecs;
				streamAudioBitrates = streamInfo.bitrates;
				var audioLevel = protocol.getQualityLevel(c);
				setDebugMessage('streamAudioQuality', streamInfo.bitrates[audioLevel]);
			}
			else {
			}
		}
		setDebugMessage('streamCount', streamCount);
		setDebugMessage('streamVideoCodecs', streamVideoCodecs);
		setDebugMessage('streamVideoBitrates', JSON.stringify(streamVideoBitrates));
		setDebugMessage('streamAudioCodecs', streamAudioCodecs);
		setDebugMessage('streamAudioBitrates', JSON.stringify(streamAudioBitrates));
		setDebugMessage('captions', JSON.stringify(captions));

		// send captions to senders
		console.log(JSON.stringify(captions));
		if (Object.keys(captions).length > 0) {
			var caption_message = {};
			caption_message['captions'] = captions;
			//messageSender(senders[0], JSON.stringify(caption_message));
			broadcast(JSON.stringify(caption_message));
		}

		// send video bitrates to senders
		if (streamVideoBitrates && Object.keys(streamVideoBitrates).length > 0) {
			var video_bitrates_message = {};
			video_bitrates_message['video_bitrates'] = streamVideoBitrates;
			broadcast(JSON.stringify(video_bitrates_message));
		}

		// send audio bitrates to senders
		if (streamAudioBitrates && Object.keys(streamAudioBitrates).length > 0) {
			var audio_bitrates_message = {};
			audio_bitrates_message['audio_bitrates'] = streamAudioBitrates;
			broadcast(JSON.stringify(audio_bitrates_message));
		}

		getPlayerState();

	});
	mediaElement.addEventListener('canplay', function (e) {
		console.log('######### MEDIA ELEMENT CAN PLAY');
		setDebugMessage('mediaElementState', 'Can Play');
		getPlayerState();
	});
	mediaElement.addEventListener('ended', function (e) {
		console.log('######### MEDIA ELEMENT ENDED');
		setDebugMessage('mediaElementState', 'Ended');
		getPlayerState();
	});
	mediaElement.addEventListener('playing', function (e) {
		console.log('######### MEDIA ELEMENT PLAYING');
		setDebugMessage('mediaElementState', 'Playing');
	});
	mediaElement.addEventListener('waiting', function (e) {
		console.log('######### MEDIA ELEMENT WAITING');
		setDebugMessage('mediaElementState', 'Waiting');
		getPlayerState();
	});
	mediaElement.addEventListener('stalled', function (e) {
		console.log('######### MEDIA ELEMENT STALLED');
		setDebugMessage('mediaElementState', 'Stalled');
		getPlayerState();
	});
	mediaElement.addEventListener('error', function (e) {
		console.log('######### MEDIA ELEMENT ERROR ' + e);
		setDebugMessage('mediaElementState', 'Error');
		getPlayerState();
	});
	mediaElement.addEventListener('abort', function (e) {
		console.log('######### MEDIA ELEMENT ABORT ' + e);
		messageBus.broadcast("mediaElement: aborted");
		setDebugMessage('mediaElementState', 'Abort');
		getPlayerState();
	});
	mediaElement.addEventListener('susppend', function (e) {
		console.log('######### MEDIA ELEMENT SUSPEND ' + e);
		setDebugMessage('mediaElementState', 'Suspended');
		getPlayerState();
	});
	mediaElement.addEventListener('progress', function (e) {
		setDebugMessage('mediaElementState', 'Progress');
		getPlayerState();
	});

	mediaElement.addEventListener('seeking', function (e) {
		console.log('######### MEDIA ELEMENT SEEKING ' + e);
		setDebugMessage('mediaElementState', 'Seeking');
		getPlayerState();
	});
	mediaElement.addEventListener('seeked', function (e) {
		console.log('######### MEDIA ELEMENT SEEKED ' + e);
		setDebugMessage('mediaElementState', 'Seeked');
		getPlayerState();
	});
}
/*
 * send message to a sender via custom message channel
 @param {string} senderId A id string for specific sender
 @param {string} message A message string
 */
function messageSender(senderId, message) {
	messageBus.send(senderId, message);
}

/*
 * broadcast message to all senders via custom message channel
 @param {string} message A message string
 */
function broadcast(message) {
	messageBus.broadcast(message);
}

/*
 * set debug message on receiver screen/TV
 @param {string} message A message string
 */
function setDebugMessage(elementId, message) {
	if (debugMode){
		document.getElementById(elementId).innerHTML = '' + JSON.stringify(message);
	}
}

/*
 * get media player state
 */
function getPlayerState() {
	if (mediaPlayer){
		var playerState = mediaPlayer.getState();
		setDebugMessage('mediaPlayerState', 'underflow: ' + playerState['underflow']);
	}
}