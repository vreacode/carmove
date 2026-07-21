package com.carmove.fieldconsole;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.EglBase;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.MediaStreamTrack;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.RtpTransceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceViewRenderer;
import org.webrtc.VideoTrack;

import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Receive-only WebRTC video client for the native Android console.
 * The server already exposes POST /api/stream/webrtc-offer, so this class
 * only handles the native PeerConnection and delegates HTTP signaling.
 */
public final class NativeWebRtcReceiver {
    public interface SignalingClient {
        String createAnswer(String sdp, String type, String streamMode) throws Exception;
    }

    public interface Listener {
        void onState(String state, String detail);
    }

    private static final Object FACTORY_LOCK = new Object();
    private static boolean factoryInitialized = false;

    private final Context context;
    private final SurfaceViewRenderer renderer;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService signalingExecutor = Executors.newSingleThreadExecutor();

    private EglBase eglBase;
    private PeerConnectionFactory factory;
    private PeerConnection peerConnection;
    private VideoTrack remoteVideoTrack;
    private SignalingClient signalingClient;
    private Listener listener;
    private String streamMode = "visible_raw";
    private final AtomicBoolean offerSent = new AtomicBoolean(false);
    private volatile boolean stopped = true;

    public NativeWebRtcReceiver(Context context, SurfaceViewRenderer renderer) {
        this.context = context.getApplicationContext();
        this.renderer = renderer;
        this.eglBase = EglBase.create();
        this.renderer.init(eglBase.getEglBaseContext(), null);
        this.renderer.setEnableHardwareScaler(true);
        this.renderer.setMirror(false);
    }

    public void start(String streamMode, SignalingClient signalingClient, Listener listener) {
        stop();
        this.streamMode = streamMode == null ? "visible_raw" : streamMode;
        this.signalingClient = signalingClient;
        this.listener = listener;
        this.offerSent.set(false);
        this.stopped = false;
        notifyState("connecting", "正在建立原生 WebRTC 连接…");

        try {
            ensureFactory();
            PeerConnection.RTCConfiguration configuration = new PeerConnection.RTCConfiguration(
                    Collections.<PeerConnection.IceServer>emptyList()
            );
            configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
            peerConnection = factory.createPeerConnection(configuration, observer);
            if (peerConnection == null) throw new IllegalStateException("无法创建 PeerConnection");
            peerConnection.addTransceiver(
                    MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
                    new RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY)
            );
            peerConnection.createOffer(offerObserver, new MediaConstraints());
        } catch (final Exception error) {
            notifyState("failed", explain(error));
        }
    }

    private void ensureFactory() {
        synchronized (FACTORY_LOCK) {
            if (!factoryInitialized) {
                PeerConnectionFactory.initialize(
                        PeerConnectionFactory.InitializationOptions.builder(context)
                                .createInitializationOptions()
                );
                factoryInitialized = true;
            }
        }
        if (factory == null) {
            factory = PeerConnectionFactory.builder()
                    .setVideoDecoderFactory(new DefaultVideoDecoderFactory(eglBase.getEglBaseContext()))
                    .createPeerConnectionFactory();
        }
    }

    private final SdpObserver offerObserver = new SdpObserver() {
        @Override
        public void onCreateSuccess(SessionDescription description) {
            if (stopped || peerConnection == null) return;
            peerConnection.setLocalDescription(new SdpObserver() {
                @Override
                public void onCreateSuccess(SessionDescription ignored) {
                }

                @Override
                public void onSetSuccess() {
                    sendOfferWhenIceReady(peerConnection);
                }

                @Override
                public void onCreateFailure(String error) {
                    notifyState("failed", error);
                }

                @Override
                public void onSetFailure(String error) {
                    notifyState("failed", "设置本地 SDP 失败：" + error);
                }
            }, description);
        }

        @Override
        public void onSetSuccess() {
        }

        @Override
        public void onCreateFailure(String error) {
            notifyState("failed", "创建 WebRTC offer 失败：" + error);
        }

        @Override
        public void onSetFailure(String error) {
            notifyState("failed", error);
        }
    };

    private void sendOfferWhenIceReady(final PeerConnection connection) {
        if (stopped || connection != peerConnection || offerSent.get()) return;
        SessionDescription local = connection.getLocalDescription();
        if (local == null) {
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    sendOfferWhenIceReady(connection);
                }
            }, 100);
            return;
        }
        if (connection.iceGatheringState() != PeerConnection.IceGatheringState.COMPLETE) {
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    sendOfferWhenIceReady(connection);
                }
            }, 100);
            return;
        }
        if (!offerSent.compareAndSet(false, true)) return;

        final String offerSdp = local.description;
        final String offerType = local.type.canonicalForm();
        signalingExecutor.submit(new Runnable() {
            @Override
            public void run() {
                try {
                    final JSONObject answerJson = new JSONObject(
                            signalingClient.createAnswer(offerSdp, offerType, streamMode)
                    );
                    final String answerSdp = answerJson.optString("sdp", "");
                    final String answerType = answerJson.optString("type", "answer");
                    if (answerSdp.isEmpty()) throw new IllegalStateException("WebRTC answer 为空");
                    final SessionDescription answer = new SessionDescription(
                            SessionDescription.Type.fromCanonicalForm(answerType),
                            answerSdp
                    );
                    mainHandler.post(new Runnable() {
                        @Override
                        public void run() {
                            if (stopped || peerConnection != connection) return;
                            connection.setRemoteDescription(new SdpObserver() {
                                @Override
                                public void onCreateSuccess(SessionDescription ignored) {
                                }

                                @Override
                                public void onSetSuccess() {
                                    notifyState("negotiated", "WebRTC 已完成媒体协商，等待视频轨道…");
                                }

                                @Override
                                public void onCreateFailure(String error) {
                                }

                                @Override
                                public void onSetFailure(String error) {
                                    notifyState("failed", "设置远端 SDP 失败：" + error);
                                }
                            }, answer);
                        }
                    });
                } catch (final Exception error) {
                    notifyState("failed", explain(error));
                }
            }
        });
    }

    private final PeerConnection.Observer observer = new PeerConnection.Observer() {
        @Override
        public void onSignalingChange(PeerConnection.SignalingState state) {
        }

        @Override
        public void onIceConnectionChange(PeerConnection.IceConnectionState state) {
            if (state == PeerConnection.IceConnectionState.CONNECTED || state == PeerConnection.IceConnectionState.COMPLETED) {
                notifyState("connected", "WebRTC 实时画面已连接");
            } else if (state == PeerConnection.IceConnectionState.FAILED) {
                notifyState("failed", "WebRTC ICE 连接失败");
            } else if (state == PeerConnection.IceConnectionState.DISCONNECTED) {
                notifyState("reconnecting", "WebRTC 网络短暂中断，等待恢复…");
            }
        }

        @Override
        public void onIceConnectionReceivingChange(boolean receiving) {
        }

        @Override
        public void onIceGatheringChange(PeerConnection.IceGatheringState state) {
            if (state == PeerConnection.IceGatheringState.COMPLETE && peerConnection != null) {
                sendOfferWhenIceReady(peerConnection);
            }
        }

        @Override
        public void onIceCandidate(org.webrtc.IceCandidate candidate) {
            // The server accepts a complete SDP offer; candidates are gathered before sending it.
        }

        @Override
        public void onIceCandidatesRemoved(org.webrtc.IceCandidate[] candidates) {
        }

        @Override
        public void onAddStream(MediaStream stream) {
            if (!stream.videoTracks.isEmpty()) attachVideoTrack(stream.videoTracks.get(0));
        }

        @Override
        public void onRemoveStream(MediaStream stream) {
        }

        @Override
        public void onDataChannel(org.webrtc.DataChannel channel) {
        }

        @Override
        public void onRenegotiationNeeded() {
        }

        @Override
        public void onAddTrack(RtpReceiver receiver, MediaStream[] mediaStreams) {
            attachVideoTrack(receiver.track());
        }

        @Override
        public void onTrack(RtpTransceiver transceiver) {
            attachVideoTrack(transceiver.getReceiver().track());
        }
    };

    private void attachVideoTrack(final MediaStreamTrack track) {
        if (!(track instanceof VideoTrack)) return;
        final VideoTrack videoTrack = (VideoTrack) track;
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (stopped) return;
                if (remoteVideoTrack != null && remoteVideoTrack != videoTrack) {
                    remoteVideoTrack.removeSink(renderer);
                }
                remoteVideoTrack = videoTrack;
                remoteVideoTrack.setEnabled(true);
                remoteVideoTrack.addSink(renderer);
                notifyState("connected", "WebRTC 视频轨道已接入");
            }
        });
    }

    public void stop() {
        stopped = true;
        offerSent.set(false);
        if (remoteVideoTrack != null) {
            remoteVideoTrack.removeSink(renderer);
            remoteVideoTrack = null;
        }
        if (peerConnection != null) {
            peerConnection.close();
            peerConnection.dispose();
            peerConnection = null;
        }
    }

    public void release() {
        stop();
        if (factory != null) {
            factory.dispose();
            factory = null;
        }
        if (eglBase != null) {
            renderer.release();
            eglBase.release();
            eglBase = null;
        }
        signalingExecutor.shutdownNow();
    }

    private void notifyState(String state, String detail) {
        if (listener != null) listener.onState(state, detail);
    }

    private String explain(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? "WebRTC 连接失败" : message.replace("\n", " ");
    }
}
