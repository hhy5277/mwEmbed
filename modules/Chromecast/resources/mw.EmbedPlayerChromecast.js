/*
 * The "kaltura player" embedPlayer interface for fallback h.264 and flv video format support
 */
(function ( mw, $ ) {
    "use strict";

    mw.EmbedPlayerChromecast = {
        instanceOf: 'Chromecast',
        bindPostfix: '.ccPlayer',
        supports: {
            'playHead': true,
            'pause': true,
            'stop': true,
            'volumeControl': true
        },
        supportedPlugins: [ 'doubleClick', 'youbora', 'kAnalony', 'related', 'comScoreStreamingTag', 'watermark', 'heartbeat' ],
        seeking: false,
        startOffset: 0,
        currentTime: 0,
        duration: 0,
        userSlide: false,
        volume: 1,
        autoPlay: true,
        vid: {
            'readyState': 1
        },
        isCasting: true,
        castContext: null,
        remotePlayer: null,
        remotePlayerController: null,
        receiverName: null,
        LOCAL_PLAYER_STATE: {
            START: "start",
            LOAD: "load",
            PLAY: "play",
            PAUSE: "pause",
            END: "end"
        },
        REMOTE_PLAYER_STATE: {
            IDLE: 'IDLE',
            PLAYING: 'PLAYING',
            PAUSED: 'PAUSED',
            BUFFERING: 'BUFFERING'
        },

        setup: function ( readyCallback ) {
            mw.log( 'EmbedPlayerChromecast:: setup' );
            $.extend( this.vid, { 'pause': this.pause, 'play': this.play } );
            readyCallback();
        },

        play: function () {
            mw.log( "EmbedPlayerChromecast:: play" );
            if ( this.currentState === this.LOCAL_PLAYER_STATE.END ) {
                this.replay();
            } else {
                this.playLocal();
                this.playRemote();
            }
        },

        playLocal: function () {
            $( this.vid ).trigger( "onplay" );
            this.parent_play();
            $( this ).trigger( "playing" );
        },

        playRemote: function () {
            if ( this.remotePlayer && this.remotePlayer.isPaused ) {
                this.remotePlayerController.playOrPause();
            }
        },

        pause: function () {
            mw.log( "EmbedPlayerChromecast:: pause" );
            this.pauseLocal();
            this.pauseRemote();
        },

        pauseLocal: function () {
            $( this.vid ).trigger( "onpause" );
            this.parent_pause();
        },

        pauseRemote: function () {
            if ( this.remotePlayer && !this.remotePlayer.isPaused ) {
                this.remotePlayerController.playOrPause();
            }
        },

        seek: function ( seekTime ) {
            mw.log( "EmbedPlayerChromecast:: seek to " + seekTime );
            this.seekLocal( seekTime );
            this.seekRemote( seekTime );
        },

        seekLocal: function ( seekTime ) {
            this.seeking = true;
            $( this.vid ).trigger( 'seek' );
            this.currentTime = seekTime;
            this.vid.currentTime = seekTime;
            $( this ).trigger( 'seeked' );
            this.seeking = false;
        },

        seekRemote: function ( seekTime ) {
            if ( this.remotePlayer ) {
                this.remotePlayer.currentTime = seekTime;
                this.remotePlayerController.seek();
            }
        },

        replay: function () {
            mw.log( 'EmbedPlayerChromecast:: replay' );
            this.addPlayerSpinner();
            this.loadMedia();
            this.playLocal();
            $( this ).trigger( 'updatePlayHeadPercent', [ this.currentTime / this.duration ] );
        },

        updatePlayhead: function ( currentTime, duration ) {
            mw.log( "updatePlayhead:: currentTime=" + currentTime + ", duration=" + duration );
            this.currentTime = currentTime;
            this.vid.currentTime = currentTime;
            this.updateDuration( duration );
            if ( !this.seeking && !this.userSlide && duration ) {
                $( this ).trigger( 'updatePlayHeadPercent', [ currentTime / duration ] );
                $( this ).trigger( 'timeupdate' );
            }
            $( this ).trigger( 'monitorEvent' );
        },

        setPlayerElementVolume: function ( percent ) {
            mw.log( "EmbedPlayerChromecast:: set volume to " + percent );
            this.setVolumeLocal( percent );
            this.setVolumeRemote( percent );
        },

        setVolumeLocal: function ( percent ) {
            this.volume = percent;
        },

        setVolumeRemote: function ( percent ) {
            if ( this.remotePlayer ) {
                this.remotePlayer.volumeLevel = percent;
                this.remotePlayerController.setVolumeLevel();
            }
        },

        clipDone: function () {
            mw.log( "EmbedPlayerChromecast:: clip done" );
            if ( this.vid.mediaFinishedCallback ) {
                this.vid.mediaFinishedCallback();
                this.vid.mediaFinishedCallback = null;
            }
            $( this.vid ).trigger( "ended" );
            this.onClipDone();
        },

        updateDuration: function ( duration ) {
            this.vid.duration = duration;
            this.duration = duration;
            $( this ).trigger( 'durationChange', [ duration ] );
        },

        setupChromeSender: function ( remotePlayer, remotePlayerController ) {
            mw.log( "EmbedPlayerChromecast:: setupChromeSender" );
            this.remotePlayer = remotePlayer;
            this.remotePlayerController = remotePlayerController;
            this.castContext = cast.framework.CastContext.getInstance();
            this.receiverName = this.getReceiverName();
            this.setupRemotePlayerController();
            this.loadMedia();
        },

        getReceiverName: function () {
            return this.castContext.getCurrentSession().getApplicationMetadata().name || '';
        },

        setupRemotePlayerController: function () {
            mw.log( "EmbedPlayerChromecast:: setupRemotePlayerController" );
            this.remotePlayerController.addEventListener(
                cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
                this.onPlayerStateChanged.bind( this ) );
            this.remotePlayerController.addEventListener(
                cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
                this.onCurrentTimeChanged.bind( this ) );
            this.remotePlayerController.addEventListener(
                cast.framework.RemotePlayerEventType.DURATION_CHANGED,
                this.onDurationChanged.bind( this ) );
            this.remotePlayerController.addEventListener(
                cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
                this.onVolumeLevelChanged.bind( this ) );
            this.remotePlayerController.addEventListener(
                cast.framework.RemotePlayerEventType.IS_MUTED_CHANGED,
                this.onIsMutedChanged.bind( this ) );
            this.remotePlayerController.addEventListener(
                cast.framework.RemotePlayerEventType.MEDIA_INFO_CHANGED,
                this.onMediaInfoChanged.bind( this ) );
        },

        onPlayerStateChanged: function () {
            mw.log( "EmbedPlayerChromecast:: RemotePlayerEventType -> onPlayerStateChanged:: " + this.remotePlayer.playerState );
            switch ( this.remotePlayer.playerState ) {
                case this.REMOTE_PLAYER_STATE.IDLE:
                    this.clipDone();
                    this.updatePlayhead( this.duration, this.duration );
                    break;
                case this.REMOTE_PLAYER_STATE.PLAYING:
                    if ( this.currentState !== this.LOCAL_PLAYER_STATE.PLAY ) {
                        this.play();
                    }
                    this.hideSpinner();
                    break;
                case this.REMOTE_PLAYER_STATE.PAUSED:
                    if ( this.currentState !== this.LOCAL_PLAYER_STATE.PAUSE ) {
                        this.pause();
                    }
                    break;
                case this.REMOTE_PLAYER_STATE.BUFFERING:
                    this.addPlayerSpinner();
                    break;
            }
        },

        onCurrentTimeChanged: function () {
            mw.log( "EmbedPlayerChromecast:: RemotePlayerEventType -> onCurrentTimeChanged: " + this.remotePlayer.currentTime );
            if ( this.remotePlayer.currentTime < this.remotePlayer.duration ) {
                this.updatePlayhead( this.remotePlayer.currentTime, this.remotePlayer.duration );
            }
        },

        onDurationChanged: function () {
            mw.log( "EmbedPlayerChromecast:: RemotePlayerEventType -> onDurationChanged: " + this.remotePlayer.duration );
            if ( this.remotePlayer.duration > 0 ) {
                this.updateDuration( this.remotePlayer.duration );
            }
        },

        onVolumeLevelChanged: function () {
            mw.log( "EmbedPlayerChromecast:: RemotePlayerEventType -> onVolumeLevelChanged: " + this.remotePlayer.volumeLevel );
            this.volume = this.remotePlayer.volumeLevel;
            this.triggerHelper( "volumeChanged", this.volume );
        },

        onIsMutedChanged: function () {
            mw.log( "EmbedPlayerChromecast:: RemotePlayerEventType -> onIsMutedChanged: " + this.remotePlayer.isMuted );
            if ( this.remotePlayer.isMuted ) {
                this.toggleMute( true );
            } else {
                this.toggleMute();
            }
        },

        onMediaInfoChanged: function () {
            mw.log( "EmbedPlayerChromecast:: RemotePlayerEventType -> onMediaInfoChanged" );
            var newMediaInfo = this.remotePlayer.mediaInfo;
            if ( newMediaInfo ) {
                if ( newMediaInfo.customData && newMediaInfo.customData.adsInfo ) {
                }
                if ( newMediaInfo.tracks ) {
                }
            }
        },

        loadMedia: function () {
            mw.log( "EmbedPlayerChromecast:: loadMedia" );
            var contentId = this.kentryid;
            var contentType = this.getSource().mimeType;
            // Setup media info
            var mediaInfo = new chrome.cast.media.MediaInfo( contentId, contentType );
            mediaInfo.duration = this.getDuration();
            mediaInfo.streamType = this.isLive() ? chrome.cast.media.StreamType.LIVE : chrome.cast.media.StreamType.BUFFERED;
            mediaInfo.customData = { embedConfig: this.getEmbedConfig() };
            mediaInfo.metadata = this.getMediaMetadata();
            // Setup load request
            var loadRequest = new chrome.cast.media.LoadRequest( mediaInfo );
            loadRequest.autoplay = this.autoPlay;
            loadRequest.currentTime = this.getPlayerElementTime();
            // Call load media
            this.castContext.getCurrentSession().loadMedia( loadRequest ).then(
                this.onMediaLoaded.bind( this ),
                this.launchError.bind( this )
            );
        },

        onMediaLoaded: function () {
            mw.log( "EmbedPlayerChromecast:: onAfterMediaLoaded" );
            if ( this.currentState === this.LOCAL_PLAYER_STATE.START ) {
                var chromeCastSource = this.getChromecastSource();
                if ( chromeCastSource ) {
                    this.mediaElement.setSource( chromeCastSource );
                    this.updateScreen();
                    this.updatePosterHTML();
                    this.addPlayerSpinner();
                }
            } else {

            }
            this.play();
        },

        getEmbedConfig: function () {
            mw.log( "EmbedPlayerChromecast:: getEmbedConfig" );
            return {
                'publisherID': this.kwidgetid.substr( 1 ),
                'uiconfID': this.kuiconfid,
                'entryID': this.kentryid,
                'flashVars': this.getFlashVars()
            };
        },

        getMediaMetadata: function () {
            mw.log( "EmbedPlayerChromecast:: getMediaMetadata" );
            var embedPlayerMetadata = this.kalturaPlayerMetaData;
            var mediaMetadata = new chrome.cast.media.MovieMediaMetadata();
            mediaMetadata.images = [ new chrome.cast.Image( embedPlayerMetadata.thumbnailUrl ) ];
            mediaMetadata.title = embedPlayerMetadata.name || '';
            mediaMetadata.subtitle = embedPlayerMetadata.description || '';
            return mediaMetadata;
        },

        getFlashVars: function () {
            mw.log( "EmbedPlayerChromecast:: getFlashVars" );
            var _this = this;
            var fv = {};
            this.supportedPlugins.forEach( function ( plugin ) {
                if ( !$.isEmptyObject( _this.getRawKalturaConfig( plugin ) ) ) {
                    fv[ plugin ] = _this.getRawKalturaConfig( plugin );
                }
            } );
            var proxyData = this.getProxyData();
            if ( proxyData ) {
                fv[ 'proxyData' ] = proxyData;
            }
            if ( this.getFlashvars( "ks" ) ) {
                fv[ "ks" ] = this.getFlashvars( "ks" );
            }
            return fv;
        },

        getProxyData: function () {
            mw.log( "EmbedPlayerChromecast:: getProxyData" );
            var proxyData = mw.getConfig( 'proxyData' );
            if ( proxyData ) {
                var _this = this;
                var recursiveIteration = function ( object ) {
                    for ( var property in object ) {
                        if ( object.hasOwnProperty( property ) ) {
                            if ( typeof object[ property ] == "object" ) {
                                recursiveIteration( object[ property ] );
                            } else {
                                object[ property ] = _this.evaluate( object[ property ] );
                            }
                        }
                    }
                };
                recursiveIteration( proxyData );
                return proxyData;
            } else {
                proxyData = this.getKalturaConfig( 'originalProxyData' );
                if ( !$.isEmptyObject( proxyData ) ) {
                    if ( proxyData.data ) {
                        return proxyData.data;
                    } else {
                        return proxyData;
                    }
                }
            }
        },

        launchError: function ( errorCode ) {
            mw.log( "EmbedPlayerChromecast:: launchError" );
            this.triggerHelper( "chromecastError", errorCode );
        },

        getChromecastSource: function () {
            mw.log( "EmbedPlayerChromecast:: getChromecastSource" );
            var sources = this.mediaElement.sources;
            var videoSize = 0;
            var newSource = null;
            var supportedMimeTypes = [ 'video/mp4', 'application/dash+xml', 'application/vnd.apple.mpegurl' ];
            for ( var i = 0; i < sources.length; i++ ) {
                var source = sources[ i ];
                if ( $.inArray( source.mimeType, supportedMimeTypes ) !== -1 ) {
                    if ( source.sizebytes && parseInt( source.sizebytes ) > videoSize ) { // find the best quality MP4 source
                        newSource = source;
                        videoSize = parseInt( newSource.sizebytes );
                    } else {
                        newSource = source;
                    }
                }
            }
            if ( newSource ) {
                sources.push( newSource );
                return newSource;
            } else {
                mw.log( "EmbedPlayerChromecast:: Could not find a source suitable for casting" );
                return false;
            }
        },

        updateScreen: function () {
            mw.log( "EmbedPlayerChromecast:: updateScreen" );
            var _this = this;
            if ( !mw.getConfig( 'disableSenderUI' ) ) {
                this.getInterface().find( ".chromecastScreen" ).remove();
                this.getVideoHolder().append( this.getPlayingScreen() );
                $( ".chromecastThumb" ).load( function () {
                    setTimeout( function () {
                        _this.setPlayingScreen();
                    }, 0 );
                } );
            }
        },

        getPlayingScreen: function () {
            var thumbnail = (mw.getConfig( 'defaultThumbnail' ) !== null) ? mw.getConfig( 'defaultThumbnail' ) : this.poster;
            return '<div class="chromecastScreen" style="background-color: rgba(0,0,0,0.7); width: 100%; height: 100%; font-family: Arial; position: absolute">' +
                '<div class="chromecastPlayback">' +
                '<div class="chromecastThumbBorder">' +
                '<img class="chromecastThumb" src="' + thumbnail + '"/></div> ' +
                '<div class="titleHolder">' +
                '<span class="chromecastTitle"></span><br>' +
                '<div><i class="icon-chromecast chromecastPlayingIcon chromecastPlaying"></i>' +
                '<span class="chromecastPlaying">' + gM( 'mwe-chromecast-playing' ) + '</span>' +
                '<span id="chromecastReceiverName" class="chromecastPlaying chromecastReceiverName"></span>' +
                '</div></div></div></div>';
        },

        setPlayingScreen: function () {
            var factor = $( ".chromecastThumb" ).naturalWidth() / $( ".chromecastThumb" ).naturalHeight();
            var thumbWidth = 116;
            $( ".chromecastThumb" ).width( thumbWidth );
            $( ".chromecastThumbBorder" ).width( thumbWidth );
            $( ".chromecastThumb" ).height( thumbWidth / factor );
            $( ".chromecastThumbBorder" ).height( thumbWidth / factor );
            var title = this.evaluate( '{mediaProxy.entry.name}' );
            $( ".chromecastTitle" ).text( title );
            $( "#chromecastReceiverName" ).text( this.receiverName );
        },

        syncCurrentTime: function () {
        },

        monitor: function () {
        },

        isInSequence: function () {
            return false;
        },

        getPlayerElementTime: function () {
            return this.currentTime;
        },

        isDVR: function () {
            return false;
        },

        backToLive: function () {
            var _this = this;
            $( this ).trigger( "chromecastBackToLive" );
            setTimeout( function () {
                _this.triggerHelper( 'movingBackToLive' ); //for some reason on Mac the isLive client response is a little bit delayed, so in order to get update liveUI properly, we need to delay "movingBackToLive" helper
            }, 1000 );
        },

        getPlayerElement: function () {
            return this.vid;
        },

        isVideoSiblingEnabled: function () {
            return false;
        },

        switchPlaySource: function ( source, switchCallback ) {
            this.vid.mediaLoadedCallback = switchCallback;
        },

        canAutoPlay: function () {
            return true;
        },

        changeMediaCallback: function ( callback ) {
            var _this = this;
            // Check if we have source
            if ( !this.getSource() ) {
                callback();
                return;
            }
            this.switchPlaySource( this.getSource(), function () {
                mw.setConfig( 'EmbedPlayer.KeepPoster', true );
                mw.setConfig( 'EmbedPlayer.HidePosterOnStart', false );
                setTimeout( function () {
                    _this.updatePosterHTML();
                }, 0 );
                callback();
            } );
        },
    };
})( mediaWiki, jQuery );
