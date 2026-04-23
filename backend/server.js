'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8787);
const STALE_PARTICIPANT_MS = 35_000;
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;
const MAX_PARTICIPANTS_PER_ROOM = 50;
const INVITE_CODE_LENGTH = 6;
const AUDIT_LOG_RETENTION_DAYS = 30;
const AUDIT_LOG_DIR = path.join(__dirname, 'logs');
const AUDIT_LOG_FILE_PREFIX = 'security-audit-';

const rooms = new Map();
const inviteCodeToRoomId = new Map();
let lastAuditPruneAt = 0;

function ensureAuditLogDir() {
  fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
}

function getAuditLogPath(date = new Date()) {
  return path.join(AUDIT_LOG_DIR, `${AUDIT_LOG_FILE_PREFIX}${date.toISOString().slice(0, 10)}.jsonl`);
}

function pruneAuditLogs(now = Date.now()) {
  ensureAuditLogDir();

  const cutoff = now - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = fs.readdirSync(AUDIT_LOG_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const match = entry.name.match(/^security-audit-(\d{4}-\d{2}-\d{2})\.jsonl$/);

    if (!match) {
      continue;
    }

    const fileDate = Date.parse(`${match[1]}T00:00:00.000Z`);

    if (!Number.isFinite(fileDate) || fileDate >= cutoff) {
      continue;
    }

    fs.unlinkSync(path.join(AUDIT_LOG_DIR, entry.name));
  }
}

function maybePruneAuditLogs(now = Date.now()) {
  if (now - lastAuditPruneAt < 12 * 60 * 60 * 1000) {
    return;
  }

  lastAuditPruneAt = now;

  try {
    pruneAuditLogs(now);
  } catch (error) {
    console.error('Failed to prune audit logs:', error);
  }
}

function sanitizeAuditDetails(details) {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 200) : value])
  );
}

function writeAuditLog(event, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    event,
    ...sanitizeAuditDetails(details)
  };

  maybePruneAuditLogs();

  try {
    ensureAuditLogDir();
    fs.appendFileSync(getAuditLogPath(), `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

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

function normalizeDisplayName(input) {
  const text = String(input || '').trim().slice(0, 20);
  if (text) {
    return text;
  }

  return `用户${Math.floor(Math.random() * 9000) + 1000}`;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function createInviteCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';

    for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!inviteCodeToRoomId.has(code)) {
      return code;
    }
  }

  throw new Error('邀请码生成失败，请重试。');
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

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > 1_000_000) {
        reject(new Error('请求体过大。'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('请求体不是合法的 JSON。'));
      }
    });

    req.on('error', reject);
  });
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeLocation(rawLocation) {
  if (!rawLocation || typeof rawLocation !== 'object') {
    return null;
  }

  const latitude = toFiniteNumber(rawLocation.latitude);
  const longitude = toFiniteNumber(rawLocation.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  const accuracy = toFiniteNumber(rawLocation.accuracy);
  const speed = toFiniteNumber(rawLocation.speed);
  const heading = toFiniteNumber(rawLocation.heading);
  const timestamp = toFiniteNumber(rawLocation.timestamp);

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: accuracy === null ? null : Number(accuracy.toFixed(2)),
    speed: speed === null ? null : Number(speed.toFixed(2)),
    heading: heading === null ? null : Number(heading.toFixed(2)),
    timestamp: timestamp === null ? Date.now() : Math.trunc(timestamp),
    updatedAt: Date.now()
  };
}

function makePublicParticipant(participant) {
  return {
    participantId: participant.participantId,
    displayName: participant.displayName,
    joinedAt: participant.joinedAt,
    online: Boolean(participant.socket && !participant.socket.destroyed),
    location: participant.location
  };
}

function makePublicRoom(room) {
  return {
    roomId: room.roomId,
    inviteCode: room.inviteCode,
    createdAt: room.createdAt,
    hostParticipantId: room.hostParticipantId,
    participantCount: room.participants.size
  };
}

function getParticipantList(room) {
  return Array.from(room.participants.values())
    .sort((left, right) => left.joinedAt - right.joinedAt)
    .map(makePublicParticipant);
}

function totalParticipantCount() {
  let count = 0;

  for (const room of rooms.values()) {
    count += room.participants.size;
  }

  return count;
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
  broadcastToRoom(room, {
    type: 'room:update',
    payload: {
      room: makePublicRoom(room),
      participants: getParticipantList(room)
    }
  });
}

function removeRoomIfEmpty(room) {
  if (room.participants.size > 0) {
    return;
  }

  inviteCodeToRoomId.delete(room.inviteCode);
  rooms.delete(room.roomId);
}

function detachSocket(room, participant, { notify = true } = {}) {
  if (!participant || !participant.socket) {
    return;
  }

  if (participant.socket.__closing) {
    participant.socket = null;
  } else {
    participant.socket.__closing = true;
    participant.socket.end();
    participant.socket = null;
  }

  participant.lastHeartbeatAt = Date.now();
  participant.location = null;

  if (notify) {
    broadcastRoomUpdate(room);
  }
}

function removeParticipant(room, participantId) {
  const participant = room.participants.get(participantId);

  if (!participant) {
    return false;
  }

  if (participant.socket && !participant.socket.destroyed) {
    participant.socket.__closing = true;
    participant.socket.end();
  }

  room.participants.delete(participantId);
  writeAuditLog('participant_removed', {
    roomId: room.roomId,
    participantId,
    inviteCode: room.inviteCode,
    remoteAddress: participant.lastRemoteAddress,
    reason: participant.removalReason || 'removed'
  });

  if (room.hostParticipantId === participantId) {
    const nextHost = room.participants.values().next();
    room.hostParticipantId = nextHost.done ? null : nextHost.value.participantId;
  }

  broadcastRoomUpdate(room);
  removeRoomIfEmpty(room);
  return true;
}

function createRoom(displayName) {
  const roomId = createId('room');
  const participantId = createId('user');
  const inviteCode = createInviteCode();
  const token = createToken();
  const now = Date.now();

  const participant = {
    participantId,
    token,
    displayName: normalizeDisplayName(displayName),
    joinedAt: now,
    lastHeartbeatAt: now,
    location: null,
    socket: null
  };

  const room = {
    roomId,
    inviteCode,
    createdAt: now,
    hostParticipantId: participantId,
    participants: new Map([[participantId, participant]])
  };

  rooms.set(roomId, room);
  inviteCodeToRoomId.set(inviteCode, roomId);

  return {
    room,
    participant
  };
}

function joinRoom(inviteCode, displayName) {
  const normalizedCode = String(inviteCode || '').trim().toUpperCase();
  const roomId = inviteCodeToRoomId.get(normalizedCode);

  if (!roomId) {
    throw new Error('邀请码不存在，请确认后重试。');
  }

  const room = rooms.get(roomId);

  if (!room) {
    inviteCodeToRoomId.delete(normalizedCode);
    throw new Error('房间不存在，请重新创建。');
  }

  if (room.participants.size >= MAX_PARTICIPANTS_PER_ROOM) {
    throw new Error('房间人数已满。');
  }

  const participant = {
    participantId: createId('user'),
    token: createToken(),
    displayName: normalizeDisplayName(displayName),
    joinedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    location: null,
    socket: null
  };

  room.participants.set(participant.participantId, participant);
  return {
    room,
    participant
  };
}

function verifyParticipant(roomId, participantId, token) {
  const room = rooms.get(roomId);

  if (!room) {
    return { room: null, participant: null, error: '房间不存在。' };
  }

  const participant = room.participants.get(participantId);

  if (!participant || participant.token !== token) {
    return { room: null, participant: null, error: '身份校验失败。' };
  }

  return { room, participant, error: null };
}

function createSessionResponse(room, participant) {
  return {
    room: makePublicRoom(room),
    participants: getParticipantList(room),
    session: {
      roomId: room.roomId,
      inviteCode: room.inviteCode,
      participantId: participant.participantId,
      displayName: participant.displayName,
      token: participant.token
    }
  };
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
      throw new Error('帧长度超出支持范围。');
    }

    payloadLength = Number(extendedLength);
    offset = 10;
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

function clearParticipantLocation(room, participant, reason) {
  participant.lastHeartbeatAt = Date.now();
  participant.location = null;

  writeAuditLog('location_cleared', {
    roomId: room.roomId,
    participantId: participant.participantId,
    inviteCode: room.inviteCode,
    remoteAddress: participant.lastRemoteAddress,
    reason
  });

  broadcastRoomUpdate(room);
}

function handleSocketPayload(room, participant, payload) {
  let message;

  try {
    message = JSON.parse(payload.toString('utf8'));
  } catch (error) {
    writeAuditLog('socket_message_rejected', {
      roomId: room.roomId,
      participantId: participant.participantId,
      inviteCode: room.inviteCode,
      remoteAddress: participant.lastRemoteAddress,
      reason: 'invalid_json'
    });
    sendSocketJson(participant.socket, { type: 'error', message: 'WebSocket 消息不是合法 JSON。' });
    return;
  }

  participant.lastHeartbeatAt = Date.now();

  if (message.type === 'heartbeat') {
    sendSocketJson(participant.socket, { type: 'heartbeat:ack', at: Date.now() });
    return;
  }

  if (message.type === 'leave') {
    participant.removalReason = 'socket_leave';
    removeParticipant(room, participant.participantId);
    return;
  }

  if (message.type === 'location:clear') {
    clearParticipantLocation(room, participant, 'socket_clear');
    return;
  }

  if (message.type === 'location:update') {
    const location = sanitizeLocation(message.payload);

    if (!location) {
      writeAuditLog('location_update_rejected', {
        roomId: room.roomId,
        participantId: participant.participantId,
        inviteCode: room.inviteCode,
        remoteAddress: participant.lastRemoteAddress,
        reason: 'invalid_location'
      });
      sendSocketJson(participant.socket, { type: 'error', message: '位置数据格式无效。' });
      return;
    }

    participant.location = location;

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

  writeAuditLog('socket_message_rejected', {
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
  participant.lastHeartbeatAt = Date.now();
  participant.lastRemoteAddress = getRemoteAddress(socket);
  socket.__frameBuffer = Buffer.alloc(0);
  socket.__closing = false;
  socket.__disconnectLogged = false;
  socket.setNoDelay(true);
  writeAuditLog('socket_connected', {
    roomId: room.roomId,
    participantId: participant.participantId,
    inviteCode: room.inviteCode,
    remoteAddress: participant.lastRemoteAddress
  });

  const handleSocketGone = () => {
    if (!socket.__disconnectLogged) {
      socket.__disconnectLogged = true;
      writeAuditLog('socket_disconnected', {
        roomId: room.roomId,
        participantId: participant.participantId,
        inviteCode: room.inviteCode,
        remoteAddress: participant.lastRemoteAddress
      });
    }

    if (participant.socket === socket) {
      participant.socket = null;
      participant.location = null;
      participant.lastHeartbeatAt = Date.now();
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
        handleSocketPayload(room, participant, frame.payload);
      }
    }
  });

  socket.on('close', handleSocketGone);
  socket.on('end', handleSocketGone);
  socket.on('error', handleSocketGone);

  sendSocketJson(socket, {
    type: 'sync',
    payload: {
      room: makePublicRoom(room),
      participants: getParticipantList(room)
    }
  });

  broadcastRoomUpdate(room);
}

const server = http.createServer(async (req, res) => {
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
    sendJson(res, 200, {
      ok: true,
      rooms: rooms.size,
      participants: totalParticipantCount(),
      now: Date.now()
    });
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/rooms') {
    try {
      const body = await parseRequestBody(req);
      const { room, participant } = createRoom(body.displayName);
      participant.lastRemoteAddress = getRemoteAddress(req);
      writeAuditLog('room_created', {
        roomId: room.roomId,
        participantId: participant.participantId,
        inviteCode: room.inviteCode,
        remoteAddress: participant.lastRemoteAddress
      });
      sendJson(res, 201, createSessionResponse(room, participant));
    } catch (error) {
      writeAuditLog('room_create_rejected', {
        remoteAddress: getRemoteAddress(req),
        reason: error.message
      });
      createError(res, 400, error.message);
    }
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/rooms/join') {
    let body;

    try {
      body = await parseRequestBody(req);
      const { room, participant } = joinRoom(body.inviteCode, body.displayName);
      participant.lastRemoteAddress = getRemoteAddress(req);
      writeAuditLog('room_joined', {
        roomId: room.roomId,
        participantId: participant.participantId,
        inviteCode: room.inviteCode,
        remoteAddress: participant.lastRemoteAddress
      });
      sendJson(res, 200, createSessionResponse(room, participant));
      broadcastRoomUpdate(room);
    } catch (error) {
      writeAuditLog('room_join_rejected', {
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
      const { room, participant, error } = verifyParticipant(body.roomId, body.participantId, body.token);

      if (error) {
        writeAuditLog('room_leave_rejected', {
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
      removeParticipant(room, participant.participantId);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      writeAuditLog('room_leave_rejected', {
        remoteAddress: getRemoteAddress(req),
        reason: error.message
      });
      createError(res, 400, error.message);
    }
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/rooms/')) {
    const roomId = requestUrl.pathname.replace('/api/rooms/', '');
    const participantId = requestUrl.searchParams.get('participantId');
    const token = requestUrl.searchParams.get('token');
    const { room, error } = verifyParticipant(roomId, participantId, token);

    if (error) {
      createError(res, 401, error);
      return;
    }

    sendJson(res, 200, {
      room: makePublicRoom(room),
      participants: getParticipantList(room)
    });
    return;
  }

  createError(res, 404, '接口不存在。');
});

server.on('upgrade', (req, socket) => {
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
      writeAuditLog('socket_upgrade_rejected', {
        remoteAddress: getRemoteAddress(req),
        reason: 'missing_credentials'
      });
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const { room, participant, error } = verifyParticipant(roomId, participantId, token);

    if (error) {
      writeAuditLog('socket_upgrade_rejected', {
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
      writeAuditLog('socket_upgrade_rejected', {
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
    writeAuditLog('socket_upgrade_rejected', {
      remoteAddress: getRemoteAddress(socket),
      reason: error.message
    });
    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    socket.destroy();
  }
});

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    for (const participant of Array.from(room.participants.values())) {
      const hasSocket = Boolean(participant.socket && !participant.socket.destroyed);

      if (hasSocket && now - participant.lastHeartbeatAt > STALE_PARTICIPANT_MS) {
        participant.socket.__closing = true;
        participant.socket.destroy();
        participant.socket = null;
      }

      if (!hasSocket && now - participant.lastHeartbeatAt > STALE_PARTICIPANT_MS) {
        participant.removalReason = 'connection_timeout';
        removeParticipant(room, participant.participantId);
      }
    }

    if (room.participants.size === 0 && now - room.createdAt > ROOM_IDLE_MS) {
      removeRoomIfEmpty(room);
    }
  }
}, 5_000).unref();

maybePruneAuditLogs();

server.listen(PORT, HOST, () => {
  console.log(`Live location backend running on http://${HOST}:${PORT}`);
});
