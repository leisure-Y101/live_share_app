'use strict';

const crypto = require('crypto');
const http = require('http');

const { createAuditLogger } = require('./src/audit-log');
const { createConfig } = require('./src/config');
const { createStateStore } = require('./src/state-store');

const config = createConfig();
const audit = createAuditLogger(config);
const state = createStateStore(config);
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_WEBSOCKET_PAYLOAD_BYTES = 16 * 1024;

function getRemoteAddress(source) {
  if (!source) {
    return null;
  }

  if (source.headers && typeof source.headers['x-forwarded-for'] === 'string') {
    return source.headers['x-forwarded-for'].split(',')[0].trim();
  }

  const socket = source.socket || source;
  return socket && socket.remoteAddress ? socket.remoteAddress : null;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });

  res.end(body);
}

function createError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > MAX_REQUEST_BODY_BYTES) {
        rejected = true;
        reject(new Error('请求体过大。'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (rejected) {
        return;
      }

      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('请求体必须是 JSON 对象。'));
          return;
        }

        resolve(parsed);
      } catch (error) {
        reject(new Error('请求体不是合法的 JSON。'));
      }
    });

    req.on('error', reject);
  });
}

function createWebSocketAcceptValue(key) {
  return crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'utf8')
    .digest('base64');
}

function encodeFrame(opcode, payloadBuffer) {
  const payloadLength = payloadBuffer.length;
  let header;

  if (payloadLength < 126) {
    header = Buffer.alloc(2);
    header[1] = payloadLength;
  } else if (payloadLength < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payloadBuffer]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const opcode = firstByte & 0x0f;
  const isMasked = (secondByte & 0x80) === 0x80;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) {
      return null;
    }

    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) {
      return null;
    }

    const extendedLength = buffer.readBigUInt64BE(2);

    if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('WebSocket 帧长度超出支持范围。');
    }

    payloadLength = Number(extendedLength);
    offset = 10;
  }

  if (payloadLength > MAX_WEBSOCKET_PAYLOAD_BYTES) {
    throw new Error('WebSocket 消息过大。');
  }

  if (!isMasked) {
    throw new Error('客户端 WebSocket 消息必须经过掩码处理。');
  }

  const maskOffset = offset;

  if (isMasked) {
    if (buffer.length < offset + 4) {
      return null;
    }

    offset += 4;
  }

  if (buffer.length < offset + payloadLength) {
    return null;
  }

  let payload = buffer.subarray(offset, offset + payloadLength);

  if (isMasked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    const decoded = Buffer.allocUnsafe(payloadLength);

    for (let index = 0; index < payloadLength; index += 1) {
      decoded[index] = payload[index] ^ mask[index % 4];
    }

    payload = decoded;
  }

  return {
    opcode,
    payload,
    bytesConsumed: offset + payloadLength
  };
}

function sendSocketJson(socket, payload) {
  if (!socket || socket.destroyed) {
    return;
  }

  const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
  socket.write(encodeFrame(0x1, Buffer.from(content, 'utf8')));
}

function sendSocketPong(socket, payload) {
  if (!socket || socket.destroyed) {
    return;
  }

  socket.write(encodeFrame(0xA, payload));
}

function broadcastToRoom(room, payload) {
  const encoded = JSON.stringify(payload);

  for (const participant of room.participants.values()) {
    if (participant.socket && !participant.socket.destroyed) {
      sendSocketJson(participant.socket, encoded);
    }
  }
}

function broadcastRoomUpdate(room) {
  if (!room) {
    return;
  }

  broadcastToRoom(room, {
    type: 'room:update',
    payload: {
      room: state.makePublicRoom(room),
      participants: state.getParticipantList(room)
    }
  });
}

async function handleSocketPayload(room, participant, payload) {
  let message;

  if (payload.length > MAX_WEBSOCKET_PAYLOAD_BYTES) {
    audit.write('socket_message_rejected', {
      roomId: room.roomId,
      participantId: participant.participantId,
      inviteCode: room.inviteCode,
      remoteAddress: participant.lastRemoteAddress,
      reason: 'payload_too_large'
    });
    sendSocketJson(participant.socket, { type: 'error', message: 'WebSocket 消息过大。' });
    return;
  }

  try {
    message = JSON.parse(payload.toString('utf8'));
  } catch (error) {
    audit.write('socket_message_rejected', {
      roomId: room.roomId,
      participantId: participant.participantId,
      inviteCode: room.inviteCode,
      remoteAddress: participant.lastRemoteAddress,
      reason: 'invalid_json'
    });
    sendSocketJson(participant.socket, { type: 'error', message: 'WebSocket 消息不是合法 JSON。' });
    return;
  }

  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
    audit.write('socket_message_rejected', {
      roomId: room.roomId,
      participantId: participant.participantId,
      inviteCode: room.inviteCode,
      remoteAddress: participant.lastRemoteAddress,
      reason: 'invalid_message_shape'
    });
    sendSocketJson(participant.socket, { type: 'error', message: 'WebSocket 消息格式无效。' });
    return;
  }

  if (message.type === 'heartbeat') {
    await state.touchParticipant(room, participant, participant.lastRemoteAddress);
    sendSocketJson(participant.socket, { type: 'heartbeat:ack', at: Date.now() });
    return;
  }

  if (message.type === 'leave') {
    participant.removalReason = 'socket_leave';
    await state.removeParticipant(room, participant.participantId, {
      reason: 'socket_leave',
      remoteAddress: participant.lastRemoteAddress
    });
    audit.write('participant_removed', {
      roomId: room.roomId,
      participantId: participant.participantId,
      inviteCode: room.inviteCode,
      remoteAddress: participant.lastRemoteAddress,
      reason: 'socket_leave'
    });
    broadcastRoomUpdate(room);
    return;
  }

  if (message.type === 'location:clear') {
    await state.clearParticipantLocation(room, participant, participant.lastRemoteAddress);
    audit.write('location_cleared', {
      roomId: room.roomId,
      participantId: participant.participantId,
      inviteCode: room.inviteCode,
      remoteAddress: participant.lastRemoteAddress,
      reason: 'socket_clear'
    });
    broadcastRoomUpdate(room);
    return;
  }

  if (message.type === 'location:update') {
    const location = await state.updateParticipantLocation(
      room,
      participant,
      message.payload,
      participant.lastRemoteAddress
    );

    if (!location) {
      audit.write('location_update_rejected', {
        roomId: room.roomId,
        participantId: participant.participantId,
        inviteCode: room.inviteCode,
        remoteAddress: participant.lastRemoteAddress,
        reason: 'invalid_location'
      });
      sendSocketJson(participant.socket, { type: 'error', message: '位置数据格式无效。' });
      return;
    }

    broadcastToRoom(room, {
      type: 'location:update',
      payload: {
        participantId: participant.participantId,
        displayName: participant.displayName,
        online: true,
        joinedAt: participant.joinedAt,
        location
      }
    });
    return;
  }

  audit.write('socket_message_rejected', {
    roomId: room.roomId,
    participantId: participant.participantId,
    inviteCode: room.inviteCode,
    remoteAddress: participant.lastRemoteAddress,
    reason: 'unknown_message_type'
  });
  sendSocketJson(participant.socket, { type: 'error', message: '未知的 WebSocket 消息类型。' });
}

function attachSocketToParticipant(socket, room, participant) {
  if (participant.socket && participant.socket !== socket && !participant.socket.destroyed) {
    participant.socket.__closing = true;
    participant.socket.end();
  }

  participant.socket = socket;
  participant.lastRemoteAddress = getRemoteAddress(socket);
  socket.__frameBuffer = Buffer.alloc(0);
  socket.__closing = false;
  socket.__disconnectHandled = false;
  socket.setNoDelay(true);

  void state.markParticipantConnected(room, participant, participant.lastRemoteAddress);

  audit.write('socket_connected', {
    roomId: room.roomId,
    participantId: participant.participantId,
    inviteCode: room.inviteCode,
    remoteAddress: participant.lastRemoteAddress
  });

  const handleSocketGone = async () => {
    if (socket.__disconnectHandled) {
      return;
    }

    socket.__disconnectHandled = true;

    audit.write('socket_disconnected', {
      roomId: room.roomId,
      participantId: participant.participantId,
      inviteCode: room.inviteCode,
      remoteAddress: participant.lastRemoteAddress
    });

    if (room.participants.get(participant.participantId) === participant && participant.socket === socket) {
      await state.markParticipantDisconnected(room, participant, participant.lastRemoteAddress);
      broadcastRoomUpdate(room);
    }
  };

  socket.on('data', (chunk) => {
    socket.__frameBuffer = Buffer.concat([socket.__frameBuffer, chunk]);

    while (socket.__frameBuffer.length > 0) {
      let frame;

      try {
        frame = decodeFrame(socket.__frameBuffer);
      } catch (error) {
        sendSocketJson(socket, { type: 'error', message: error.message });
        socket.__closing = true;
        socket.destroy();
        return;
      }

      if (!frame) {
        break;
      }

      socket.__frameBuffer = socket.__frameBuffer.subarray(frame.bytesConsumed);

      if (frame.opcode === 0x8) {
        socket.__closing = true;
        socket.end();
        return;
      }

      if (frame.opcode === 0x9) {
        sendSocketPong(socket, frame.payload);
        continue;
      }

      if (frame.opcode === 0x1) {
        void handleSocketPayload(room, participant, frame.payload).catch((error) => {
          console.error('Failed to handle socket payload:', error);
          sendSocketJson(socket, { type: 'error', message: '服务端处理消息失败。' });
        });
      }
    }
  });

  socket.on('close', () => {
    void handleSocketGone();
  });
  socket.on('end', () => {
    void handleSocketGone();
  });
  socket.on('error', () => {
    void handleSocketGone();
  });

  sendSocketJson(socket, {
    type: 'sync',
    payload: {
      room: state.makePublicRoom(room),
      participants: state.getParticipantList(room)
    }
  });

  broadcastRoomUpdate(room);
}

async function requestHandler(req, res) {
  if (!req.url) {
    createError(res, 400, '请求地址无效。');
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(res, 200, state.getHealthPayload());
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/rooms') {
    try {
      const body = await parseRequestBody(req);
      const { room, participant } = await state.createRoom(body.displayName);
      participant.lastRemoteAddress = getRemoteAddress(req);
      await state.touchParticipant(room, participant, participant.lastRemoteAddress);
      audit.write('room_created', {
        roomId: room.roomId,
        participantId: participant.participantId,
        inviteCode: room.inviteCode,
        remoteAddress: participant.lastRemoteAddress
      });
      sendJson(res, 201, state.createSessionResponse(room, participant));
    } catch (error) {
      audit.write('room_create_rejected', {
        remoteAddress: getRemoteAddress(req),
        reason: error.message
      });
      createError(res, 400, error.message);
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/rooms/join') {
    let body = null;

    try {
      body = await parseRequestBody(req);
      const { room, participant } = await state.joinRoom(body.inviteCode, body.displayName);
      participant.lastRemoteAddress = getRemoteAddress(req);
      await state.touchParticipant(room, participant, participant.lastRemoteAddress);
      audit.write('room_joined', {
        roomId: room.roomId,
        participantId: participant.participantId,
        inviteCode: room.inviteCode,
        remoteAddress: participant.lastRemoteAddress
      });
      sendJson(res, 200, state.createSessionResponse(room, participant));
      broadcastRoomUpdate(room);
    } catch (error) {
      audit.write('room_join_rejected', {
        inviteCode: body && body.inviteCode,
        remoteAddress: getRemoteAddress(req),
        reason: error.message
      });
      createError(res, 400, error.message);
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/rooms/leave') {
    try {
      const body = await parseRequestBody(req);
      const { room, participant, error } = state.verifyParticipant(body.roomId, body.participantId, body.token);

      if (error) {
        audit.write('room_leave_rejected', {
          roomId: body.roomId,
          participantId: body.participantId,
          remoteAddress: getRemoteAddress(req),
          reason: error
        });
        createError(res, 401, error);
        return;
      }

      participant.removalReason = 'http_leave';
      participant.lastRemoteAddress = getRemoteAddress(req) || participant.lastRemoteAddress;
      await state.removeParticipant(room, participant.participantId, {
        reason: 'http_leave',
        remoteAddress: participant.lastRemoteAddress
      });
      audit.write('participant_removed', {
        roomId: room.roomId,
        participantId: participant.participantId,
        inviteCode: room.inviteCode,
        remoteAddress: participant.lastRemoteAddress,
        reason: 'http_leave'
      });
      sendJson(res, 200, { ok: true });
      broadcastRoomUpdate(room);
    } catch (error) {
      audit.write('room_leave_rejected', {
        remoteAddress: getRemoteAddress(req),
        reason: error.message
      });
      createError(res, 400, error.message);
    }
    return;
  }

  const roomMatch = requestUrl.pathname.match(/^\/api\/rooms\/([^/]+)$/);

  if (req.method === 'GET' && roomMatch) {
    const roomId = decodeURIComponent(roomMatch[1]);
    const participantId = requestUrl.searchParams.get('participantId');
    const token = requestUrl.searchParams.get('token');
    const { room, error } = state.verifyParticipant(roomId, participantId, token);

    if (error) {
      createError(res, 401, error);
      return;
    }

    sendJson(res, 200, {
      room: state.makePublicRoom(room),
      participants: state.getParticipantList(room)
    });
    return;
  }

  if (requestUrl.pathname.startsWith('/api/rooms/')) {
    createError(res, 404, '接口不存在。');
    return;
  }

  createError(res, 404, '接口不存在。');
}

async function main() {
  await state.init();
  audit.maybePrune();

  const server = http.createServer((req, res) => {
    void requestHandler(req, res).catch((error) => {
      console.error('Unhandled request error:', error);
      createError(res, 500, '服务端异常。');
    });
  });

  server.on('upgrade', (req, socket) => {
    void (async () => {
      try {
        const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

        if (requestUrl.pathname !== '/ws') {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        const roomId = requestUrl.searchParams.get('roomId');
        const participantId = requestUrl.searchParams.get('participantId');
        const token = requestUrl.searchParams.get('token');

        if (!roomId || !participantId || !token) {
          audit.write('socket_upgrade_rejected', {
            remoteAddress: getRemoteAddress(req),
            reason: 'missing_credentials'
          });
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        const { room, participant, error } = state.verifyParticipant(roomId, participantId, token);

        if (error) {
          audit.write('socket_upgrade_rejected', {
            roomId,
            participantId,
            remoteAddress: getRemoteAddress(req),
            reason: error
          });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const key = req.headers['sec-websocket-key'];

        if (!key) {
          audit.write('socket_upgrade_rejected', {
            roomId,
            participantId,
            remoteAddress: getRemoteAddress(req),
            reason: 'missing_websocket_key'
          });
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        const acceptValue = createWebSocketAcceptValue(key);

        socket.write(
          [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${acceptValue}`,
            '\r\n'
          ].join('\r\n')
        );

        attachSocketToParticipant(socket, room, participant);
      } catch (error) {
        audit.write('socket_upgrade_rejected', {
          remoteAddress: getRemoteAddress(socket),
          reason: error.message
        });
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    })();
  });

  let cleanupInFlight = false;

  setInterval(() => {
    if (cleanupInFlight) {
      return;
    }

    cleanupInFlight = true;

    void state
      .cleanup(Date.now(), config.runtime.staleParticipantMs, config.runtime.roomIdleMs)
      .then((updates) => {
        for (const update of updates) {
          if (update.removed) {
            audit.write('participant_removed', {
              roomId: update.roomId,
              participantId: update.participantId,
              inviteCode: update.inviteCode,
              remoteAddress: update.remoteAddress,
              reason: update.reason
            });
          }

          const room = state.rooms.get(update.roomId);

          if (room) {
            broadcastRoomUpdate(room);
          }
        }
      })
      .catch((error) => {
        console.error('Failed to cleanup stale participants:', error);
      })
      .finally(() => {
        cleanupInFlight = false;
      });
  }, 5_000).unref();

  server.listen(config.server.port, config.server.host, () => {
    console.log(
      `Live location backend running on http://${config.server.host}:${config.server.port} (storage: ${config.storage.driver})`
    );
  });
}

main().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exitCode = 1;
});
