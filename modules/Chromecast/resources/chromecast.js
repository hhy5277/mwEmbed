(function ( mw, $ ) {
    "use strict";

    // Add chromecast player:
    $( mw ).bind( 'EmbedPlayerUpdateMediaPlayers', function ( event, mediaPlayers ) {
        var chromecastSupportedProtocols = [ 'video/mp4' ];
        var chromecastPlayer = new mw.MediaPlayer( 'chromecast', chromecastSupportedProtocols, 'Chromecast' );
        mediaPlayers.addPlayer( chromecastPlayer );
    } );

    mw.PluginManager.add( 'chromecast', mw.KBaseComponent.extend( {

        defaultConfig: {
            'parent': 'controlsContainer',
            'order': 7,
            'visible': false,
            'align': "right",
            'applicationID': "276999A7", // DB6462E9: Chromecast default receiver, 276999A7: Kaltura custom receiver supporting DRM, HLS and smooth streaming
            'showTooltip': true,
            'tooltip': gM( 'mwe-chromecast-chromecast' ),
            'title': gM( 'mwe-chromecast-chromecast' ),
            'debugReceiver': false,
            'disableSenderUI': false
        },
        savedPlayer: null,
        isDisabled: false,
        isCasting: false,
        remotePlayer: null,
        remotePlayerController: null,
        CAST_SENDER_V3_URL: '//www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1',

        setup: function () {
            top[ '__onGCastApiAvailable' ] = this.toggleCastButton.bind( this );
            if ( mw.getConfig( 'EmbedPlayer.IsFriendlyIframe' ) ) {
                try {
                    kWidget.appendScriptUrl( this.CAST_SENDER_V3_URL, null, top.document );
                } catch ( e ) {
                    kWidget.appendScriptUrl( this.CAST_SENDER_V3_URL );
                }
            } else {
                kWidget.appendScriptUrl( this.CAST_SENDER_V3_URL );
            }
        },

        addBindings: function () {
            this.bind( 'chromecastError', function ( e, errorCode ) {
                this.launchError( errorCode );
            }.bind( this ) );
        },

        toggleCastButton: function ( isAvailable, reason ) {
            this.log( "toggleCastButton: isAvailable=" + isAvailable + ", reason=" + reason );
            if ( isAvailable ) {
                this.show();
            } else {
                this.hide();
            }
        },

        toggleCast: function () {
            this.log( "toggleCast: isDisabled=" + this.isDisabled + ", isCasting=" + this.isCasting );
            if ( this.isDisabled ) {
                return false;
            }
            if ( !this.isCasting ) {
                window.chrome = top.chrome || window.chrome;
                window.cast = top.cast || window.cast;
                this.initializeCastApi();
                this.showConnectingMessage();
                this.embedPlayer.disablePlayControls( [ "chromecast" ] );
                cast.framework.CastContext.getInstance().requestSession().then(
                    this.switchPlayer.bind( this ),
                    this.launchError.bind( this )
                );
            } else {
                this.endSession();
            }
        },

        initializeCastApi: function () {
            this.log( "initializeCastApi" );
            var options = {};
            options.receiverApplicationId = this.getConfig( "applicationID" ).toString();
            options.autoJoinPolicy = chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED;
            cast.framework.CastContext.getInstance().setOptions( options );
            this.remotePlayer = new cast.framework.RemotePlayer();
            this.remotePlayerController = new cast.framework.RemotePlayerController( this.remotePlayer );
        },

        getComponent: function () {
            if ( !this.$el ) {
                this.$el = $( '<button/>' )
                    .attr( 'title', this.startCastTitle )
                    .addClass( "btn icon-chromecast" + this.getCssClass() )
                    .click( function () {
                        this.toggleCast();
                    }.bind( this ) );
            }
            return this.$el;
        },

        endSession: function () {
            this.log( "endSession" );
            this.isCasting = false;
            this.embedPlayer.remotePlayerController.stop();
            this.embedPlayer.castContext.getCurrentSession().endSession( true );
            this.getComponent().css( "color", "white" );
            this.updateTooltip( this.startCastTitle );
            this.embedPlayer.getInterface().find( ".chromecastScreen" ).remove();
        },

        switchPlayer: function () {
            this.log( "switchPlayer" );
            this.isCasting = true;
            this.getComponent().css( "color", "#35BCDA" );
            this.updateTooltip( this.stopCastTitle );
            this.embedPlayer.layoutBuilder.closeAlert();
            this.embedPlayer.updatePosterHTML();
            this.showLoadingMessage();
            this.savedPlayer = this.embedPlayer.selectedPlayer;
            this.embedPlayer.selectPlayer( mw.EmbedTypes.mediaPlayers.getPlayerById( 'chromecast' ) );
            this.embedPlayer.updatePlaybackInterface( function () {
                this.embedPlayer.setupChromeSender( this.remotePlayer, this.remotePlayerController );
            }.bind( this ) );
        },

        launchError: function ( errorCode ) {
            this.log( "launchError: " + this.getErrorMessage( errorCode ) );
            this.embedPlayer.layoutBuilder.closeAlert();
            this.embedPlayer.enablePlayControls();
        },

        getErrorMessage: function ( errorCode ) {
            this.log( "getErrorMessage: errorCode=" + errorCode );
            switch ( errorCode ) {
                case chrome.cast.ErrorCode.API_NOT_INITIALIZED:
                    return 'The API is not initialized.';
                case chrome.cast.ErrorCode.CANCEL:
                    return 'The operation was canceled by the user';
                case chrome.cast.ErrorCode.CHANNEL_ERROR:
                    return 'A channel to the receiver is not available.';
                case chrome.cast.ErrorCode.EXTENSION_MISSING:
                    return 'The Cast extension is not available.';
                case chrome.cast.ErrorCode.INVALID_PARAMETER:
                    return 'The parameters to the operation were not valid.';
                case chrome.cast.ErrorCode.RECEIVER_UNAVAILABLE:
                    return 'No receiver was compatible with the session request.';
                case chrome.cast.ErrorCode.SESSION_ERROR:
                    return 'A session could not be created, or a session was invalid.';
                case chrome.cast.ErrorCode.TIMEOUT:
                    return 'The operation timed out.';
            }
        },

        showConnectingMessage: function () {
            if ( this.getConfig( 'disableSenderUI' ) ) {
                return;
            }
            this.displayMessage( gM( 'mwe-chromecast-connecting' ) );
        },

        showLoadingMessage: function () {
            if ( this.getConfig( 'disableSenderUI' ) ) {
                return;
            }
            this.displayMessage( gM( 'mwe-chromecast-loading' ) );
        },

        displayMessage: function ( msg ) {
            this.embedPlayer.layoutBuilder.displayAlert( {
                    'title': 'Chromecast Player',
                    'message': msg,
                    'isModal': true,
                    'keepOverlay': true,
                    'noButtons': true,
                    'isError': true,
                    'props': {
                        'customAlertContainerCssClass': 'connectingMsg',
                        'customAlertTitleCssClass': 'hidden',
                        'textColor': '#ffffff'
                    }
                }
            );
        }
    } ) );
})( window.mw, window.jQuery );
