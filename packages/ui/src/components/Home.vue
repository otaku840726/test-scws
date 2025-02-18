<template>
  <v-container class="fill-height">
    <v-responsive class="align-center text-center fill-height">
      <h2 v-if="!isStreaming" class="text-h2 font-weight-bold">
        Android Apps Streaming
      </h2>
      <DeviceControls v-if="isStreaming" :sendEvent="send" :fullscreen="fullscreen" :frames-rendered="framesRendered"
        :frames-skipped="framesSkipped"/>
      <v-row class="d-flex align-center justify-center">
        <v-col cols="auto">
          <input type="text" id="hiddenInput" v-model="virtualInput" style="position:absolute; left:-9999px;" @input="proxyInput" @keydown="proxyKeyDown" @keyup="proxyKeyUp">
          <div id="fullscreen" :style="{
            'max-width': '100%',
            'max-height': '100%',
            display: 'flex',
            'flex-direction': 'column',
            background: 'black',
          }" @keydown="handleKeyDown" @keyup="handleKeyUp">
            <div id="video-canvas" :style="{
              transform: `translate(${(rotatedWidth - width) / 2}px, ${(rotatedHeight - height) / 2}px) rotate(${rotation * 90}deg)`,
			  'max-width': '100%',
			  'max-height': '100%'
            }" @pointerdown="handlePointerDown" @pointermove="handlePointerMove" @pointerup="handlePointerUp"
              @pointercancel="handlePointerUp" @pointerleave="handlePointerLeave" @contextmenu="handleContextMenu">
            </div>
          </div>
        </v-col>
      </v-row>
      <DeviceActions @onStart="start" :is-ws-open="isWsOpen" :sendEvent="send"/>
      <v-row class="d-flex align-center justify-center pb-4">
        <v-col lg="8" md="12">
          <FileList />
        </v-col>
      </v-row>
    </v-responsive>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import {
	ScrcpyVideoCodecId,
	ScrcpyAudioCodec,
	AndroidKeyCode,
	AndroidKeyEventAction,
	AndroidKeyEventMeta,
	AndroidMotionEventAction,
	AndroidMotionEventButton,
	ScrcpyPointerId,
	// ScrcpyHoverHelper,
	ScrcpyControlMessageType,
} from "@yume-chan/scrcpy";
import { TinyH264Decoder } from "@yume-chan/scrcpy-decoder-tinyh264";
import { 
	InsertableStreamVideoFrameRenderer,
  	WebGLVideoFrameRenderer,
 	BitmapVideoFrameRenderer, 
	WebCodecsVideoDecoder
} from "@yume-chan/scrcpy-decoder-webcodecs";
import {
	Float32PcmPlayer,
	Float32PlanerPcmPlayer,
	Int16PcmPlayer,
} from "@yume-chan/pcm-player";
import { ReadableStream, WritableStream } from "@yume-chan/stream-extra";
import { AacDecodeStream, OpusDecodeStream } from "@/utils/audio-decode-stream";
import { Packr, Unpackr } from "msgpackr";
import { useAdbStore } from "@/store/adb";
import { useFileStore } from "@/store/file";
import { streamingService } from "@/services/stream/streaming-service";
import FileList from "@/components/file/FileList";
import DeviceActions from "@/components/device/DeviceActions";
import DeviceControls from "@/components/device/DeviceControls";
import { mapClientToDevicePosition } from "@/utils/mapClientToDevicePosition";
import {
	PACK_OPTIONS,
	DEAULT_BIT_RATE,
	DEAULT_MAX_FPS,
	DEAULT_PROTOCOL,
	DEAULT_MAX_SIZE
} from "@/utils/constants";

import wrtc from "@roamhq/wrtc";

const MOUSE_EVENT_BUTTON_TO_ANDROID_BUTTON = [
	AndroidMotionEventButton.Primary,
	AndroidMotionEventButton.Tertiary,
	AndroidMotionEventButton.Secondary,
	AndroidMotionEventButton.Back,
	AndroidMotionEventButton.Forward,
];
const packer = new Packr(PACK_OPTIONS);
const unpacker = new Unpackr(PACK_OPTIONS);

const adbStore = useAdbStore();
const fileStore = useFileStore();

let container;
let fullscreen;
let renderer;
let audioPlayer;
let ws;
let peer;
let mediaChannel;

const iceServers = [
	{ urls: "stun:stun.l.google.com:19302" },
	// { urls: "stun:stun1.l.google.com:19302" },
	// { urls: "stun:stun2.l.google.com:19302" },
	// { urls: "stun:stun3.l.google.com:19302" },
];

let abortController;
let decoder;
let videoController;
let audioController;
let framesInterval;

// const hoverHelper = new ScrcpyHoverHelper();
const width = ref(adbStore.displaySize?.width || 0);
const height = ref(adbStore.displaySize?.height || 0);
const rotation = ref(0);

const framesRendered = ref(0);
const framesSkipped = ref(0);

const isStreaming = ref(false);
const isWsOpen = ref(false);
const controlLeft = ref(false);
const controlRight = ref(false);
const shiftLeft = ref(false);
const shiftRight = ref(false);
const altLeft = ref(false);
const altRight = ref(false);
const metaLeft = ref(false);
const metaRight = ref(false);
const capsLock = ref(false);
const numLock = ref(true);
const keys = new Set();

const rotatedWidth = computed(() => {
	return rotation.value & 1 ? height.value : width.value;
});
const rotatedHeight = computed(() => {
	return rotation.value & 1 ? width.value : height.value;
});

const route = useRoute();

onMounted(async () => {
	container = document.getElementById("video-canvas");
	fullscreen = document.getElementById("fullscreen");

	await Promise.all([
		adbStore.metainfo(),
		fileStore.getUplaods(),
		fileStore.getApps(),
	]);

	if (route.query.serial) {
		const serial = route.query.serial;
		adbStore.device = serial;
	}
	let maxFps = DEAULT_MAX_FPS;
	if (route.query.maxFps) {
		maxFps = route.query.maxFps;
	}
	let bitRate = DEAULT_BIT_RATE;
	if (route.query.bitRate) {
		bitRate = route.query.bitRate;
	}
	let maxSize = DEAULT_MAX_SIZE;
	if (route.query.maxSize) {
		maxSize = route.query.maxSize;
	}
	await start({ maxFps: maxFps, bitRate: bitRate, maxSize: maxSize });
});

const setModifier = (keyCode, value) => {
	switch (keyCode) {
		case AndroidKeyCode.ControlLeft:
			controlLeft.value = value;
			break;
		case AndroidKeyCode.ControlRight:
			controlRight.value = value;
			break;
		case AndroidKeyCode.ShiftLeft:
			shiftLeft.value = value;
			break;
		case AndroidKeyCode.ShiftRight:
			shiftRight.value = value;
			break;
		case AndroidKeyCode.AltLeft:
			altLeft.value = value;
			break;
		case AndroidKeyCode.AltRight:
			altRight.value = value;
			break;
		case AndroidKeyCode.MetaLeft:
			metaLeft.value = value;
			break;
		case AndroidKeyCode.MetaRight:
			metaRight.value = value;
			break;
		case AndroidKeyCode.CapsLock:
			if (value) {
				capsLock.value = !capsLock.value;
			}
			break;
		case AndroidKeyCode.NumLock:
			if (value) {
				numLock.value = !numLock.value;
			}
			break;
	}
};

const getMetaState = () => {
	let metaState = 0;
	if (altLeft.value) {
		metaState |= AndroidKeyEventMeta.AltOn | AndroidKeyEventMeta.AltLeftOn;
	}
	if (altRight.value) {
		metaState |= AndroidKeyEventMeta.AltOn | AndroidKeyEventMeta.AltRightOn;
	}
	if (shiftLeft.value) {
		metaState |= AndroidKeyEventMeta.ShiftOn | AndroidKeyEventMeta.ShiftLeftOn;
	}
	if (shiftRight.value) {
		metaState |= AndroidKeyEventMeta.ShiftOn | AndroidKeyEventMeta.ShiftRightOn;
	}
	if (controlLeft.value) {
		metaState |= AndroidKeyEventMeta.CtrlOn | AndroidKeyEventMeta.CtrlLeftOn;
	}
	if (controlRight.value) {
		metaState |= AndroidKeyEventMeta.CtrlOn | AndroidKeyEventMeta.CtrlRightOn;
	}
	if (metaLeft.value) {
		metaState |= AndroidKeyEventMeta.MetaOn | AndroidKeyEventMeta.MetaLeftOn;
	}
	if (metaRight.value) {
		metaState |= AndroidKeyEventMeta.MetaOn | AndroidKeyEventMeta.MetaRightOn;
	}
	if (capsLock.value) {
		metaState |= AndroidKeyEventMeta.CapsLockOn;
	}
	if (numLock.value) {
		metaState |= AndroidKeyEventMeta.NumLockOn;
	}
	return metaState;
};

const down = async (key) => {
	const keyCode = AndroidKeyCode[key];
	if (!keyCode) {
		console.log("unknown key");
		return;
	}

	setModifier(keyCode, true);
	keys.add(keyCode);

	const payload = {
		action: AndroidKeyEventAction.Down,
		keyCode,
		metaState: getMetaState(),
		repeat: 0,
	};
	send({
		cmd: "injectKeyCode",
		payload,
	});
	// await this.client.controlMessageWriter?.injectKeyCode();
};

const up = async (key) => {
	const keyCode = AndroidKeyCode[key];
	if (!keyCode) {
		return;
	}

	setModifier(keyCode, false);
	keys.delete(keyCode);

	send({
		cmd: "injectKeyCode",
		payload: {
			action: AndroidKeyEventAction.Up,
			keyCode,
			metaState: getMetaState(),
			repeat: 0,
		},
	});
};

const reset = async () => {
	controlLeft.value = false;
	controlRight.value = false;
	shiftLeft.value = false;
	shiftRight.value = false;
	altLeft.value = false;
	altRight.value = false;
	metaLeft.value = false;
	metaRight.value = false;
	for (const key of keys) {
		up(AndroidKeyCode[key]);
	}
	keys.clear();
};

const send = (message) => {
	const record = packer.pack(message);
	if (ws && (message.isWebrtc || adbStore.protocol === 'websocket')) {
		ws.send(record);
	} else if (adbStore.protocol === 'webrtc' && mediaChannel) {
		mediaChannel.send(record);
	}
};

const dispose = async () => {
	if (abortController) {
		await abortController.abort();
		console.log("abortController.aborted");
	}
	if (decoder) {
		await decoder.dispose();
		decoder = undefined;
		console.log("decoder disposed");
	}
	if (audioPlayer) {
		await audioPlayer.stop();
		audioPlayer = undefined;
		console.log("audioPlayer stopped");
	}
	if (ws) {
		await ws.close();
		ws = undefined;
		console.log("ws closed");
	}
	if (mediaChannel) {
		await mediaChannel.close();
		mediaChannel = undefined;
		console.log("mediaChannel closed");
	}
	if (peer) {
		await peer.close();
		peer = undefined;
		console.log("peer closed");
	}
	if (framesInterval) {
		clearTimeout(framesInterval);
		framesInterval = undefined;
	}
	while (container.firstChild) {
		console.log("Removing container.firstChild");
		container.firstChild.remove();
	}
};

const  createVideoFrameRenderer = () => {
//   if (InsertableStreamVideoFrameRenderer.isSupported) {
// 	console.log('InsertableStreamVideoFrameRenderer')
//     return new InsertableStreamVideoFrameRenderer();
//   }

  if (WebGLVideoFrameRenderer.isSupported) {
	console.log('WebGLVideoFrameRenderer')
    return new WebGLVideoFrameRenderer(null, false);
  }

  console.log('BitmapVideoFrameRenderer')
  return BitmapVideoFrameRenderer();
}

// const createOffer = async() => {
//   const offer = await peer.createOffer();
//   console.dir(offer)
//   await peer.setLocalDescription(offer);
//   send({isWebrtc: true, type: 'offer', sdp: peer.localDescription });
//   console.dir(peer.localDescription)
// }

const start = async ({ maxFps, bitRate, maxSize }) => {
	await dispose();

	abortController = new AbortController();
	isStreaming.value = true;

	if (["off", "raw"].includes(adbStore.audioEncoderObj?.codec)) {
		audioPlayer = new Int16PcmPlayer(48000, 2);
	} else if (["aac","flac"].includes(adbStore.audioEncoderObj?.codec)) {
		audioPlayer = new Float32PlanerPcmPlayer(48000, 2);
	} else if (["opus"].includes(adbStore.audioEncoderObj?.codec)) {
		audioPlayer = new Float32PcmPlayer(48000, 2);
	}
	if (["off", "TinyH264"].includes(adbStore.videoEncoderObj?.decoder)) {
		decoder = new TinyH264Decoder();
		renderer = decoder.renderer;
	} else if (["WebCodecs"].includes(adbStore.videoEncoderObj?.decoder)) {
		let codec;
		switch (adbStore.videoEncoderObj?.codec) {
			case "h264": {
				codec = ScrcpyVideoCodecId.H264;
				break;
			}
			case "h265": {
				codec = ScrcpyVideoCodecId.H265;
				break;
			}
			case "av1": {
				codec = ScrcpyVideoCodecId.AV1;
				break;
			}
		}
		const newRenderer = createVideoFrameRenderer();
		renderer = newRenderer.canvas ? newRenderer.canvas : newRenderer.element;
		decoder = new WebCodecsVideoDecoder({
			codec: codec , 
			renderer: newRenderer
		}); //
	}

	renderer.style.maxWidth = "100%";
	renderer.style.height = "85vh";
	renderer.style.touchAction = "none";
	renderer.style.outline = "none";
	container.appendChild(renderer);

	decoder.sizeChanged(({ width: width2, height: height2 }) => {
		if (width.value !== width2) {
			width.value = width2
			console.log(`RESIZE: width=${width2}`);
		}
		if (height.value !== height2){
			height.value = height2;
			console.log(`RESIZE: height=${height2}`);
		}
	});

	fullscreen.addEventListener("wheel", handleWheel, {
		passive: false,
	});
	fullscreen.tabIndex = 0;
	renderer.setAttribute("aria-label", "Device Screen");

	new ReadableStream({
		start(controller) {
			videoController = controller;
		},
	})
		.pipeTo(decoder.writable, {
			signal: abortController.signal,
		})
		.catch((e) => {
			console.log(e);
			if (abortController.signal.aborted) {
				return;
			}
		});
	if (["off", "raw"].includes(adbStore.audioEncoderObj?.codec)) {
		new ReadableStream({
			start(controller) {
				audioController = controller;
			},
		})
			.pipeTo(
				new WritableStream({
					write: (chunk) => {
						audioPlayer.feed(chunk.data);
					},
				}),
			)
			.catch((e) => {
				console.log(e)
				if (abortController.signal.aborted) {
					return;
				}
			});
	} else if (["aac"].includes(adbStore.audioEncoderObj?.codec)) {
		new ReadableStream({
			start(controller) {
				audioController = controller;
			},
		})
			.pipeThrough(
				new AacDecodeStream({
					codec: ScrcpyAudioCodec.Aac.webCodecId, //metadata.codec.webCodecId,
					numberOfChannels: 2,
					sampleRate: 48000,
				}),
				{
					signal: abortController.signal,
				},
			)
			.pipeTo(
				new WritableStream({
					write: (chunk) => {
						audioPlayer.feed(chunk);
					},
				}),
				{
					signal: abortController.signal,
				},
			)
			.catch((e) => {
				if (abortController.signal.aborted) {
					return;
				}
			});
	} else if (["opus"].includes(adbStore.audioEncoderObj?.codec)) {
		new ReadableStream({
			start(controller) {
				audioController = controller;
			},
		})
			.pipeThrough(
				new OpusDecodeStream({
					codec: ScrcpyAudioCodec.Opus.webCodecId, //metadata.codec.webCodecId,
					numberOfChannels: 2,
					sampleRate: 48000,
				}),
				{
					signal: abortController.signal,
				},
			)
			.pipeTo(
				new WritableStream({
					write: (chunk) => {
						audioPlayer.feed(chunk);
					},
				}),
				{
					signal: abortController.signal,
				},
			)
			.catch((e) => {
				if (abortController.signal.aborted) {
					return;
				}
			});
	}else if (["flac"].includes(adbStore.audioEncoderObj?.codec)) {
		new ReadableStream({
			start(controller) {
				audioController = controller;
			},
		})
			.pipeThrough(
				new AacDecodeStream({
					codec: ScrcpyAudioCodec.Flac.webCodecId, //metadata.codec.webCodecId,
					numberOfChannels: 2,
					sampleRate: 48000,
				}),
				{
					signal: abortController.signal,
				},
			)
			.pipeTo(
				new WritableStream({
					write: (chunk) => {
						audioPlayer.feed(chunk);
					},
				}),
				{
					signal: abortController.signal,
				},
			)
			.catch((e) => {
				if (abortController.signal.aborted) {
					return;
				}
			});
	} 

	await audioPlayer.start();

	ws = await streamingService.init({
		device: adbStore.device,
		audio: adbStore.audioEncoderObj?.name !== "off",
		audioCodec:
			adbStore.audioEncoderObj?.codec === "off"
				? undefined
				: adbStore.audioEncoderObj?.codec,
		audioEncoder:
			adbStore.audioEncoderObj?.encoder === "off"
				? undefined
				: adbStore.audioEncoderObj?.name,

		video: adbStore.videoEncoderObj?.name !== "off",
		videoCodec:
			adbStore.videoEncoderObj?.codec === "off"
				? undefined
				: adbStore.videoEncoderObj?.codec,
		videoEncoder:
			adbStore.videoEncoderObj?.encoder === "off"
				? undefined
				: adbStore.videoEncoderObj?.name,

		videoBitRate: bitRate,
		maxFps: maxFps,
		maxSize: maxSize,
		protocol: adbStore.protocol,
		captureOrientation: window.innerWidth > window.innerHeight ? '0':'@0',
		onopen: (ws, id, evt) => {
			console.log(`ID=${id} CONNECTED`);
			isWsOpen.value = true;
		},
		onclose: (ws, id, evt) => {
			console.log(`ID=${id} DISCONNECTED`);
			isWsOpen.value = false;
			// dispose();
		},
		onmessage: async (ws, id, evt) => {
			try {
				const record = unpacker.unpack(evt.data);
				if (record.media === "video") {
					try {
						videoController.enqueue(record.packet);
					} catch (err) {
						console.log('video err')
						console.log(err);
					}
				} else if (record.media === "audio") {
					try {
						audioController.enqueue(record.packet);
					} catch (err) {
						console.log(err);
					}
				} else if (record.media === "message") {
					try {
						navigator.clipboard.writeText(record.message);
					} catch (err) {
						console.log(err);
					}
				}
				return;
			} catch (err) {
			}
			try {
				const record = JSON.parse(evt.data);
				if (record.offer) {
					peer = new wrtc.RTCPeerConnection({
						iceServers: iceServers,
					});

					peer.ondatachannel = (event) => {
						const dataChannel = event.channel;
						console.log("ondatachannel");

						if (event.channel.label === "media") {
							mediaChannel = dataChannel;
							mediaChannel.onopen = () => {
								console.log("mediaChannel is open");
							};

							mediaChannel.onmessage = (event) => {
								try {
									const record = unpacker.unpack(event.data);
									if (record.media) {
										if (record.media === 'video' && videoController.desiredSize !== null) {
											videoController.enqueue(record.packet);
										} else if (record.media === 'audio' && audioController.desiredSize !== null) {
											audioController.enqueue(record.packet);
										}
									}
								} catch (err) {
									console.log(err);
								}
							};
							mediaChannel.onerror = (error) => {
								console.error("mediaChannel error:", error);
							};

							mediaChannel.onclose = (e) => {
								console.log("mediaChannel is closed");
							};
						} 
					};

					peer.onicecandidate = (event) => {
						if (event.candidate) {
							send({ isWebrtc: true, candidate: event.candidate });
						}
					};

					await peer.setRemoteDescription(
						new wrtc.RTCSessionDescription(record.offer),
					);
					const answer = await peer.createAnswer();
					await peer.setLocalDescription(answer);
					send({ isWebrtc: true, answer: peer.localDescription });
				} else if (record.candidate) {
					await peer.addIceCandidate(new RTCIceCandidate(record.candidate));
				} else if (record.reconnectDataChannel) {
					console.log(`reconnectDataChannel: ${record.reconnectDataChannel}`);
				}
			} catch (err) {
				console.log("ws message not json ");
				console.dir(evt.data);
			}
		},
		onerror: (ws, id, evt) => {
			console.log(`ID=${id} ERROR=${evt.data}`);
		},
	});

	framesInterval = setInterval(() => {
		framesRendered.value = decoder.framesRendered;
		framesSkipped.value = decoder.framesSkipped;
	}, 1000);
};

document.addEventListener("visibilitychange", async function () {
	console.log(document.visibilityState);
	if (document.visibilityState === "hidden") {
		await dispose();
	}
});

const handleWheel = (e) => {
	fullscreen.focus();
	e.preventDefault();
	e.stopPropagation();

	const { x, y } = mapClientToDevicePosition({
		clientX: e.clientX,
		clientY: e.clientY,
		clientRect: renderer.getBoundingClientRect(),
		rotation: rotation.value,
		width: width.value,
		height: height.value,
	});

	send({
		cmd: "injectScroll",
		payload: {
			screenWidth: width.value,
			screenHeight: height.value,
			pointerX: x,
			pointerY: y,
			scrollX: -e.deltaX / 100,
			scrollY: -e.deltaY / 100,
			buttons: 0,
		},
	});
};

const injectTouch = (action, e) => {
	const { pointerType } = e;
	let pointerId;
	if (pointerType === "mouse") {
		// Android 13 has bug with mouse injection
		// https://github.com/Genymobile/scrcpy/issues/3708
		pointerId = ScrcpyPointerId.Finger;
	} else {
		pointerId = BigInt(e.pointerId);
	}

	const { x, y } = mapClientToDevicePosition({
		clientX: e.clientX,
		clientY: e.clientY,
		clientRect: renderer.getBoundingClientRect(),
		rotation: rotation.value,
		width: width.value,
		height: height.value,
	});

	const messages = [{
		action,
		pointerId,
		screenWidth: width.value,
		screenHeight: height.value,
		pointerX: x,
		pointerY: y,
		pressure: e.pressure,
		actionButton: MOUSE_EVENT_BUTTON_TO_ANDROID_BUTTON[e.button],
		// `MouseEvent.buttons` has the same order as Android `MotionEvent`
		buttons: e.buttons,
	}];
	for (const message of messages) {
		send({
			cmd: "injectTouch",
			payload: message,
		});
		// STATE.client.controlMessageWriter!.injectTouch(message);
	}
};

const handleKeyDown = (e) => {
	e.preventDefault();
	e.stopPropagation();
	if (e.ctrlKey && e.key === "v") {
		handleClipboardPaste(e);
	} else {
		down(e.code);
	}
};

const handleKeyUp = async (e) => {
	e.preventDefault();
	e.stopPropagation();
	up(e.code);
};

const handleClipboardPaste = async (e) => {
	const clipboardText = await navigator.clipboard.readText();
	if (clipboardText)
		send({
			cmd: "clipboardPaste",
			payload: {
				type: ScrcpyControlMessageType.SetClipboard,
				sequence: BigInt("12345"), // Use BigInt for sequence
				paste: true,
				length: clipboardText.length, // Content length
				content: clipboardText, // Clipboard content
			},
		});
};

const handlePointerDown = (e) => {
	fullscreen.focus();
	e.preventDefault();
	e.stopPropagation();

	e.currentTarget.setPointerCapture(e.pointerId);
	injectTouch(AndroidMotionEventAction.Down, e);
};

const handlePointerMove = (e) => {
	e.preventDefault();
	e.stopPropagation();
	injectTouch(
		e.buttons === 0
			? AndroidMotionEventAction.HoverMove
			: AndroidMotionEventAction.Move,
		e,
	);
};

const handlePointerUp = (e) => {
	e.preventDefault();
	e.stopPropagation();
	injectTouch(AndroidMotionEventAction.Up, e);
};

const handlePointerLeave = (e) => {
	e.preventDefault();
	e.stopPropagation();
	// Because pointer capture on pointer down, this event only happens for hovering mouse and pen.
	// Release the injected pointer, otherwise it will stuck at the last position.
	injectTouch(AndroidMotionEventAction.HoverExit, e);
	injectTouch(AndroidMotionEventAction.Up, e);
};

const handleContextMenu = (e) => {
	e.preventDefault();
};

const sendText = (val) => {
	const payload = val;
	send({
		cmd: "injectText",
		payload,
	});
};

const virtualInput = ref("");
const proxyInput = (e) => {
	e.preventDefault();
	e.stopPropagation();
	var inputText = e.target.value;
	if (inputText.length > 0) {
		sendText(inputText);
	}
	e.target.value = "";
};
const proxyKeyUp = async (e) => {
	e.preventDefault();
	e.stopPropagation();
	// console.log('e.code:', e.code);
	// console.log('e.key:', e.key);
	// console.log('e.keyCode:', e.keyCode);
	// console.log('e.which:', e.which);
	if (e.key == "Backspace") {
		up(e.key);
	}
};
const proxyKeyDown = (e) => {
	e.preventDefault();
	e.stopPropagation();
	// console.log('e.code:', e.code);
	// console.log('e.key:', e.key);
	// console.log('e.keyCode:', e.keyCode);
	// console.log('e.which:', e.which);
	if (e.key == "Backspace") {
		down(e.key);
	}
};

// 检查浏览器是否支持 WakeLock API
if ('wakeLock' in navigator) {
    let wakeLock = null;

    // 请求唤醒锁
    const requestWakeLock = async () => {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('唤醒锁已激活，屏幕将保持唤醒状态。');

            // 监听唤醒锁释放事件
            wakeLock.addEventListener('release', () => {
                console.log('唤醒锁已释放，屏幕可能会休眠。');
            });
        } catch (err) {
            console.error(`无法获取唤醒锁: ${err.message}`);
        }
    };

    // 当页面可见时重新请求唤醒锁
    document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
            await requestWakeLock();
        }
    });

    // 初始请求唤醒锁
    requestWakeLock();
} else {
    console.warn('当前浏览器不支持 WakeLock API。');
}
</script>
