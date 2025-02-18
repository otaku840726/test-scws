import * as uWs from "uWebSockets.js";
import { logger } from "./services/logger.js";
import { service as adbTcpService } from "./services/adb/adb-tcp-service.js";
import { Packr, Unpackr } from "msgpackr";

import Response from "./utils/http/response.js";
import Request from "./utils/http/request.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { global } from "./state/global.js";
import App from "./utils/http/app.js";
import { routes } from "./routes/index.js";
import { cors } from "./utils/http/middie/cors.js";
import wrtc from "@roamhq/wrtc";
import { json } from "node:stream/consumers";
const __dirname = dirname(fileURLToPath(import.meta.url));

const msgpackOptions = {
	useRecords: true,
	structuredClone: true,
	bundleStrings: true,
};

const packer = new Packr(msgpackOptions);
const unpacker = new Unpackr(msgpackOptions);

const host = process.env.HOST || "0.0.0.0";
const port = process.env.PORT || 9001;
global.users = new Map();

const iceServers = [
	{ urls: "stun:stun.l.google.com:19302" },
	// { urls: "stun:stun1.l.google.com:19302" },
	// { urls: "stun:stun2.l.google.com:19302" },
	// { urls: "stun:stun3.l.google.com:19302" },
];

const createMediaChannel = async (user) => {
	if (!user.peer) {
		return;
	}

	user.mediaChannel = user.peer.createDataChannel("media",{
		ordered: false,
		maxPacketLifeTime: 1 
	});

	user.mediaChannel.onopen = () => {
		console.log("mediaChannel is open");
	};

	user.mediaChannel.onerror = (error) => {
		console.error("mediaChannel error:", error);
	};
	user.mediaChannel.onclose = (event) => {
		console.log("mediaChannel is closed");
		if (user.protocol === 'webrtc') {
			user.client?.controller?.resetVideo();
		}
		createMediaChannel(user);
	};
	user.mediaChannel.onmessage = (event) => {
		const record = unpacker.unpack(event.data);
		if (record.cmd) {
			if (user?.client?.controller) {
				if (record.cmd === "injectKeyCode") {
					user.client.controller.injectKeyCode(record.payload);
				} else if (record.cmd === "injectTouch") {
					user.client.controller.injectTouch(record.payload);
				} else if (record.cmd === "injectScroll") {
					user.client.controller.injectScroll(record.payload);
				} else if (record.cmd === "setScreenPowerMode") {
					user.client.controller.setScreenPowerMode(record.payload);
				} else if (record.cmd === "rotateDevice") {
					user.client.controller.rotateDevice();
				} else if (record.cmd === "setScreenPowerMode") {
					user.client.controller.setScreenPowerMode(record.payload);
				} else if (record.cmd === "clipboardPaste") {
					user.client.controller.setClipboard(record.payload);
				} else if (record.cmd === "injectText") {
					user.client.controller.injectText(record.payload);
				} else {
					logger.info(`Got webrtc message record ${record}`);
				}
			}
		} else if (record.protocol) {
			user.protocol = record.protocol;
			logger.info(`Protocol ${record.protocol}`);
		}
	};
	user.ws?.send(JSON.stringify({ reconnectDataChannel: "media" }));
};

const run = async () => {
	const app = new App({
		host,
		port,
	});
	app.use(cors);
	for (const route of routes) {
		app.route(route, {});
	}
	app.server
		.ws("/*", {
			/* Options */
			compression: uWs.DEDICATED_COMPRESSOR_16KB,
			maxPayloadLength: 16 * 1024,
			idleTimeout: 0,
			/* Handlers */
			upgrade: async (res, req, context) => {
				res.upgrade(
					{
						url: req.getUrl(),
						id: req.getQuery("id"),
						device: req.getQuery("device"),
						audio: ["true", null, undefined].includes(req.getQuery("audio")),
						audioCodec: req.getQuery("audioCodec") ?? "raw",
						audioEncoder: req.getQuery("audioEncoder") ?? undefined,

						video: ["true", null, undefined].includes(req.getQuery("video")),
						videoCodec: req.getQuery("videoCodec") ?? "h264",
						videoEncoder: req.getQuery("videoEncoder") ?? undefined,

						videoBitRate: ![null, undefined].includes(
							req.getQuery("videoBitRate"),
						)
							? Number.parseInt(req.getQuery("videoBitRate")) * 1000000
							: 4_000_000,
						displayId: ![null, undefined].includes(req.getQuery("displayId"))
							? Number.parseInt(req.getQuery("displayId"))
							: 0,
						maxSize: ![null, undefined].includes(req.getQuery("maxSize"))
							? Number.parseInt(req.getQuery("maxSize"))
							: 1280,
						maxFps: ![null, undefined].includes(req.getQuery("maxFps"))
							? Number.parseInt(req.getQuery("maxFps"))
							: 60,
						protocol: ![null, undefined].includes(req.getQuery("protocol"))
							? req.getQuery("protocol")
							: 'websocket',
						captureOrientation: ![null, undefined].includes(req.getQuery("captureOrientation"))
						? req.getQuery("captureOrientation")
						: '0',
					},
					/* Use our copies here */
					req.getHeader("sec-websocket-key"),
					req.getHeader("sec-websocket-protocol"),
					req.getHeader("sec-websocket-extensions"),
					context,
				);
			},
			open: async (ws) => {
				try {
					const { id, device, protocol } = ws;
					logger.info(`WebSocket connected with id: ${id}`);
					const user = {
						ws,
						client: null,
						abortController: new AbortController(),
						peer: new wrtc.RTCPeerConnection({ iceServers }),
						mediaChannel: null,
						protocol: protocol
					};

					logger.info(`new peer connection created for user ${id}`);

					await createMediaChannel(user);

					user.peer.onicecandidate = (event) => {
						if (event.candidate) {
							logger.info("send candidate");
							user.ws?.send(
								JSON.stringify({
									candidate: event.candidate,
								}),
							);
						}
					};
					const offer = await user.peer.createOffer();
					await user.peer.setLocalDescription(offer);
					logger.info("send offer");
					user.ws?.send(
						JSON.stringify({
							offer: offer,
						}),
					);

					global.users.set(id, user);

					const deviceAdb = await adbTcpService.getDeviceAdb(device);
					const { client, options } = await adbTcpService.start(
						deviceAdb,
						user,
					);
					if (!client) {
						throw new Error("No ADB TCP CLIENT");
					}
					user.client = client;

					client.stdout.pipeTo(
						new WritableStream({
							write: (line) => {
								logger.info(line);
							},
						}),
						{ signal: user.abortController?.signal || undefined },
					);

					if (options.clipboard) {
						options.clipboard
							.pipeTo(
								new WritableStream({
									write: (message) => {
										try {
											const array = packer.pack({
												media: "message",
												message,
											});
											if (user.ws) {
												logger.info("send message");
												const ok = user.ws?.send(array, true);
												if (ok !== 1) {
													logger.info(`WS not sent with status: ${ok}`);
												}
											}
										} catch (ex) {
											logger.error(ex);
										}
									},
								}),
								{ signal: user.abortController?.signal || undefined },
							)
							.catch((e) => {
								if (user?.abortController?.signal?.aborted) {
									return;
								}
								logger.error(e);
							});
					}

					if (client.audioStream) {
						const metadata = await client.audioStream;
						switch (metadata.type) {
							case "disabled":
								// Audio not supported by device
								logger.info("AudioStream disabled");
								break;
							case "errored":
								// Other error when initializing audio
								logger.info("AudioStream errored");
								break;
							case "success": {
								let ok;
								// Audio packets in the codec specified in options
								const audioPacketStream = metadata.stream;
								audioPacketStream
									.pipeTo(
										new WritableStream({
											write(packet) {
												try {
													const array = packer.pack({
														media: "audio",
														packet,
													});
													if (user.protocol === 'websocket' && user.ws) {
														ok = user.ws?.send(array, true);
														if (!ok) logger.info("not ok", ok);
													} else if (
														user.protocol === 'webrtc' &&
														user.mediaChannel &&
														user.mediaChannel?.readyState === "open"
													) {
														user.mediaChannel?.send(array);
													}
												} catch (ex) {
													logger.error(ex);
												}
											},
										}),
										{ signal: user.abortController?.signal || undefined },
									)
									.catch((e) => {
										if (user?.abortController?.signal?.aborted) {
											return;
										}
										logger.error(e);
									});
								break;
							}
						}
					}

					if (client.videoStream) {
						const { metadata: videoMetadata, stream: videoPacketStream } =
							await client.videoStream;
						logger.info(videoMetadata);
						const array = packer.pack({
							media: "video_metadata",
							packet: videoMetadata,
						});

						// logger.info("send video_metadata")
						let ok = user.ws?.send(array, true);
						if (ok !== 1) {
							logger.info(`WS not sent with status: ${ok}`);
						}

						videoPacketStream
							.pipeTo(
								new WritableStream({
									write(packet) {
										try {
											const array = packer.pack({
												media: "video",
												packet,
											});
											if (user.protocol === 'websocket' && user.ws) {
												ok = user.ws?.send(array, true);
												if (ok !== 1) {
													logger.info(`WS not sent with status: ${ok}`);
												}
											} else if (
												user.protocol === 'webrtc' &&
												user.mediaChannel &&
												user.mediaChannel?.readyState === "open"
											) {
												user.mediaChannel.send(array);
											}
										} catch (ex) {
											logger.error(ex);
										}
									},
								}),
								{ signal: user.abortController?.signal || undefined },
							)
							.catch((e) => {
								if (user?.abortController?.signal?.aborted) {
									return;
								}
								logger.error(e);
							});
					}
				} catch (err) {
					logger.error(err);
					ws.close();
				}
			},
			message: async (ws, message, isBinary) => {
				const { id } = ws;
				try {
					const user = global.users.get(id);
					const record = unpacker.unpack(message);
					if (record.cmd) {
						if (user?.client?.controller) {
							if (record.cmd === "injectKeyCode") {
								user.client.controller.injectKeyCode(record.payload);
							} else if (record.cmd === "injectTouch") {
								user.client.controller.injectTouch(record.payload);
							} else if (record.cmd === "injectScroll") {
								user.client.controller.injectScroll(record.payload);
							} else if (record.cmd === "setScreenPowerMode") {
								user.client.controller.setScreenPowerMode(record.payload);
							} else if (record.cmd === "rotateDevice") {
								user.client.controller.rotateDevice();
							} else if (record.cmd === "setScreenPowerMode") {
								user.client.controller.setScreenPowerMode(record.payload);
							} else if (record.cmd === "clipboardPaste") {
								user.client.controller.setClipboard(record.payload);
							} else if (record.cmd === "injectText") {
								user.client.controller.injectText(record.payload);
							} else {
								logger.info(`Got ws message record ${record}`);
							}
						}
					} else if (record.protocol) {
						user.protocol = record.protocol;
						logger.info(`Protocol ${record.protocol}`);
					} else if (record.isWebrtc) {
						logger.info(`Got ws message ${JSON.stringify(record)}`);
						// if (record.type === 'offer') {
						// 	await user.peer.setRemoteDescription(new wrtc.RTCSessionDescription(record.sdp));
						// 	const answer = await user.peer.createAnswer();
						// 	await user.peer.setLocalDescription(answer);
						// 	ws.send(JSON.stringify({ type: 'answer', sdp: user.peer.localDescription }));
						//   } else if (record.type === 'candidate') {
						// 	await user.peer.addIceCandidate(record.candidate);
						// }
						if (record.answer) {
							await user.peer.setRemoteDescription(
								new wrtc.RTCSessionDescription(record.answer),
							);
						}

						if (record.candidate) {
							await user.peer.addIceCandidate(
								new wrtc.RTCIceCandidate(record.candidate),
							);
						}
					}
				} catch (ex) {
					logger.error(ex);
				}
			},
			drain: (ws) => {
				logger.info(`WebSocket backpressure: ${ws.getBufferedAmount()}`);
			},
			close: async (ws, code, message) => {
				logger.info("WebSocket closing...");
				try {
					const { id } = ws;
					const user = global.users.get(id);
					if (user) {
						if (user.abortController) {
							try {
								// user.abortController.abort();
								user.abortController = undefined;
							} catch (err) {
								logger.error(err);
							}
						}
						if (user.mediaChannel) {
							try {
								// user.abortController.abort();
								user.mediaChannel.close();
							} catch (err) {
								logger.error(err);
							}
						}
						if (user.peer) {
							try {
								// user.abortController.abort();
								user.peer.close();
							} catch (err) {
								logger.error(err);
							}
						}

						user.ws = null;
						user.peer = null;
						user.mediaChannel = null;
						global.users.set(id, {});
						if (user.client) {
							await user.client.close();
						}
					}
				} catch (ex) {
					logger.error(ex);
				}
			},
		})
		.get("/*", (res, req) => {
			const request = new Request(res, req, {});
			const response = new Response(res, req, {}, request);
			const folder = join(__dirname, "..", "ui", "dist");
			const path = req.getUrl();
			const compress = false;
			res.cork(() => {
				res.writeHeader(
					"Access-Control-Allow-Origin",
					req.getHeader("origin") || "*",
				);
				res.writeHeader("Access-Control-Allow-Credentials", "true");
				res.writeHeader(
					"Access-Control-Allow-Headers",
					"Origin, X-Api-Key, X-Requested-With, Content-Type, Accept, Authorization",
				);
				res.writeHeader(
					"Access-Control-Allow-Methods",
					"GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
				);
				response.sendFile(
					join(folder, path === "/" ? "index.html" : path),
					true,
					compress,
				);
			});
		});
	await app.start();
};

run();
