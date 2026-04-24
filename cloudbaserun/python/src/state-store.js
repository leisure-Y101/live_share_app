'use strict';

const crypto = require('crypto');

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
  const now = Date.now();
  const safeTimestamp = timestamp === null ? now : Math.trunc(timestamp);

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    accuracy: accuracy === null || accuracy < 0 || accuracy > 100000 ? null : Number(accuracy.toFixed(2)),
    speed: speed === null || speed < 0 || speed > 300 ? null : Number(speed.toFixed(2)),
    heading: heading === null || heading < 0 || heading >= 360 ? null : Number(heading.toFixed(2)),
    timestamp: Math.abs(safeTimestamp - now) > 24 * 60 * 60 * 1000 ? now : safeTimestamp,
    updatedAt: now
  };
}

function normalizeDisplayName(input) {
  const text = String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);

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

class MemoryPersistence {
  constructor() {
    this.driver = 'memory';
  }

  async init() {}

  async persistRoom() {}

  async persistParticipant() {}

  async markParticipantRemoved() {}

  async markRoomClosed() {}

  getHealthDetails() {
    return {
      storageDriver: this.driver
    };
  }
}

class MysqlPersistence {
  constructor(options) {
    this.driver = 'mysql';
    this.options = options;
    this.pool = null;
    this.mysql = null;
  }

  async init(state) {
    const { host, user, database } = this.options;

    if (!host || !user || !database) {
      throw new Error('MySQL storage is enabled but DB_HOST / DB_USER / DB_NAME is not configured.');
    }

    try {
      this.mysql = require('mysql2/promise');
    } catch (error) {
      throw new Error('mysql2 is not installed. Run "npm install" inside backend first.');
    }

    this.pool = this.mysql.createPool({
      host: this.options.host,
      port: this.options.port,
      user: this.options.user,
      password: this.options.password,
      database: this.options.database,
      charset: this.options.charset,
      connectionLimit: this.options.connectionLimit,
      waitForConnections: true,
      supportBigNumbers: true
    });

    if (this.options.autoMigrate) {
      await this.ensureSchema();
    }

    await this.loadState(state);
  }

  async ensureSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id VARCHAR(48) NOT NULL PRIMARY KEY,
        invite_code CHAR(6) NOT NULL UNIQUE,
        created_at BIGINT NOT NULL,
        host_participant_id VARCHAR(48) NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        closed_at BIGINT NULL,
        updated_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS participants (
        participant_id VARCHAR(48) NOT NULL PRIMARY KEY,
        room_id VARCHAR(48) NOT NULL,
        token VARCHAR(64) NOT NULL,
        display_name VARCHAR(64) NOT NULL,
        joined_at BIGINT NOT NULL,
        last_heartbeat_at BIGINT NOT NULL,
        last_remote_address VARCHAR(128) NULL,
        online TINYINT(1) NOT NULL DEFAULT 0,
        location_latitude DECIMAL(10, 6) NULL,
        location_longitude DECIMAL(10, 6) NULL,
        location_accuracy DECIMAL(10, 2) NULL,
        location_speed DECIMAL(10, 2) NULL,
        location_heading DECIMAL(10, 2) NULL,
        location_timestamp BIGINT NULL,
        location_updated_at BIGINT NULL,
        removal_reason VARCHAR(64) NULL,
        removed_at BIGINT NULL,
        updated_at BIGINT NOT NULL,
        CONSTRAINT fk_participants_room
          FOREIGN KEY (room_id) REFERENCES rooms(room_id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await this.ensureIndex('rooms', 'idx_rooms_status', 'CREATE INDEX idx_rooms_status ON rooms (status, updated_at)');
    await this.ensureIndex(
      'participants',
      'idx_participants_room_active',
      'CREATE INDEX idx_participants_room_active ON participants (room_id, removed_at)'
    );
    await this.ensureIndex(
      'participants',
      'idx_participants_heartbeat',
      'CREATE INDEX idx_participants_heartbeat ON participants (last_heartbeat_at)'
    );
  }

  async ensureIndex(tableName, indexName, createSql) {
    const [rows] = await this.pool.query(
      `
        SELECT 1
        FROM information_schema.statistics
        WHERE table_schema = ? AND table_name = ? AND index_name = ?
        LIMIT 1
      `,
      [this.options.database, tableName, indexName]
    );

    if (rows.length > 0) {
      return;
    }

    await this.pool.query(createSql);
  }

  async loadState(state) {
    const [roomRows] = await this.pool.query(
      `
        SELECT room_id, invite_code, created_at, host_participant_id
        FROM rooms
        WHERE status = 'active' AND closed_at IS NULL
        ORDER BY created_at ASC
      `
    );

    const [participantRows] = await this.pool.query(
      `
        SELECT
          participant_id,
          room_id,
          token,
          display_name,
          joined_at,
          last_heartbeat_at,
          last_remote_address,
          location_latitude,
          location_longitude,
          location_accuracy,
          location_speed,
          location_heading,
          location_timestamp,
          location_updated_at
        FROM participants
        WHERE removed_at IS NULL
        ORDER BY joined_at ASC
      `
    );

    for (const roomRow of roomRows) {
      state.hydrateRoom({
        roomId: roomRow.room_id,
        inviteCode: roomRow.invite_code,
        createdAt: Number(roomRow.created_at),
        hostParticipantId: roomRow.host_participant_id
      });
    }

    for (const participantRow of participantRows) {
      state.hydrateParticipant(participantRow.room_id, {
        participantId: participantRow.participant_id,
        token: participantRow.token,
        displayName: participantRow.display_name,
        joinedAt: Number(participantRow.joined_at),
        lastHeartbeatAt: Number(participantRow.last_heartbeat_at),
        lastRemoteAddress: participantRow.last_remote_address || null,
        location: null
      });
    }

    await this.resetOnlineState();
  }

  async resetOnlineState() {
    await this.pool.query(`
      UPDATE participants
      SET
        online = 0,
        location_latitude = NULL,
        location_longitude = NULL,
        location_accuracy = NULL,
        location_speed = NULL,
        location_heading = NULL,
        location_timestamp = NULL,
        location_updated_at = NULL,
        updated_at = ?
      WHERE removed_at IS NULL
    `, [Date.now()]);
  }

  async persistRoom(room) {
    const now = Date.now();

    await this.pool.query(
      `
        INSERT INTO rooms (
          room_id,
          invite_code,
          created_at,
          host_participant_id,
          status,
          closed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'active', NULL, ?)
        ON DUPLICATE KEY UPDATE
          invite_code = VALUES(invite_code),
          host_participant_id = VALUES(host_participant_id),
          status = 'active',
          closed_at = NULL,
          updated_at = VALUES(updated_at)
      `,
      [room.roomId, room.inviteCode, room.createdAt, room.hostParticipantId, now]
    );
  }

  async persistParticipant(room, participant) {
    const now = Date.now();
    const location = participant.location;

    await this.pool.query(
      `
        INSERT INTO participants (
          participant_id,
          room_id,
          token,
          display_name,
          joined_at,
          last_heartbeat_at,
          last_remote_address,
          online,
          location_latitude,
          location_longitude,
          location_accuracy,
          location_speed,
          location_heading,
          location_timestamp,
          location_updated_at,
          removal_reason,
          removed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
        ON DUPLICATE KEY UPDATE
          room_id = VALUES(room_id),
          token = VALUES(token),
          display_name = VALUES(display_name),
          last_heartbeat_at = VALUES(last_heartbeat_at),
          last_remote_address = VALUES(last_remote_address),
          online = VALUES(online),
          location_latitude = VALUES(location_latitude),
          location_longitude = VALUES(location_longitude),
          location_accuracy = VALUES(location_accuracy),
          location_speed = VALUES(location_speed),
          location_heading = VALUES(location_heading),
          location_timestamp = VALUES(location_timestamp),
          location_updated_at = VALUES(location_updated_at),
          removal_reason = NULL,
          removed_at = NULL,
          updated_at = VALUES(updated_at)
      `,
      [
        participant.participantId,
        room.roomId,
        participant.token,
        participant.displayName,
        participant.joinedAt,
        participant.lastHeartbeatAt,
        participant.lastRemoteAddress || null,
        participant.socket && !participant.socket.destroyed ? 1 : 0,
        location ? location.latitude : null,
        location ? location.longitude : null,
        location ? location.accuracy : null,
        location ? location.speed : null,
        location ? location.heading : null,
        location ? location.timestamp : null,
        location ? location.updatedAt : null,
        now
      ]
    );
  }

  async markParticipantRemoved(room, participant) {
    await this.pool.query(
      `
        UPDATE participants
        SET
          online = 0,
          location_latitude = NULL,
          location_longitude = NULL,
          location_accuracy = NULL,
          location_speed = NULL,
          location_heading = NULL,
          location_timestamp = NULL,
          location_updated_at = NULL,
          removal_reason = ?,
          removed_at = ?,
          updated_at = ?
        WHERE participant_id = ?
      `,
      [
        participant.removalReason || 'removed',
        Date.now(),
        Date.now(),
        participant.participantId
      ]
    );
  }

  async markRoomClosed(room) {
    const now = Date.now();

    await this.pool.query(
      `
        UPDATE rooms
        SET
          status = 'closed',
          closed_at = ?,
          host_participant_id = NULL,
          updated_at = ?
        WHERE room_id = ?
      `,
      [now, now, room.roomId]
    );
  }

  getHealthDetails() {
    return {
      storageDriver: this.driver,
      database: this.options.database,
      host: this.options.host,
      port: this.options.port
    };
  }
}

class LiveStateStore {
  constructor(config) {
    this.config = config;
    this.rooms = new Map();
    this.inviteCodeToRoomId = new Map();
    this.persistence = createPersistence(config);
  }

  async init() {
    await this.persistence.init(this);
  }

  hydrateRoom(roomSnapshot) {
    const room = {
      roomId: roomSnapshot.roomId,
      inviteCode: roomSnapshot.inviteCode,
      createdAt: roomSnapshot.createdAt,
      hostParticipantId: roomSnapshot.hostParticipantId || null,
      participants: new Map()
    };

    this.rooms.set(room.roomId, room);
    this.inviteCodeToRoomId.set(room.inviteCode, room.roomId);
    return room;
  }

  hydrateParticipant(roomId, participantSnapshot) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return null;
    }

    const participant = {
      participantId: participantSnapshot.participantId,
      token: participantSnapshot.token,
      displayName: participantSnapshot.displayName,
      joinedAt: participantSnapshot.joinedAt,
      lastHeartbeatAt: participantSnapshot.lastHeartbeatAt || Date.now(),
      lastRemoteAddress: participantSnapshot.lastRemoteAddress || null,
      location: participantSnapshot.location || null,
      socket: null,
      removalReason: null
    };

    room.participants.set(participant.participantId, participant);
    return participant;
  }

  createInviteCode() {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';

      for (let index = 0; index < this.config.runtime.inviteCodeLength; index += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }

      if (!this.inviteCodeToRoomId.has(code)) {
        return code;
      }
    }

    throw new Error('邀请码生成失败，请稍后重试。');
  }

  makePublicParticipant(participant) {
    return {
      participantId: participant.participantId,
      displayName: participant.displayName,
      joinedAt: participant.joinedAt,
      online: Boolean(participant.socket && !participant.socket.destroyed),
      location: participant.location
    };
  }

  makePublicRoom(room) {
    return {
      roomId: room.roomId,
      inviteCode: room.inviteCode,
      createdAt: room.createdAt,
      hostParticipantId: room.hostParticipantId,
      participantCount: room.participants.size
    };
  }

  getParticipantList(room) {
    return Array.from(room.participants.values())
      .sort((left, right) => left.joinedAt - right.joinedAt)
      .map((participant) => this.makePublicParticipant(participant));
  }

  totalParticipantCount() {
    let count = 0;

    for (const room of this.rooms.values()) {
      count += room.participants.size;
    }

    return count;
  }

  async createRoom(displayName) {
    const roomId = createId('room');
    const participantId = createId('user');
    const inviteCode = this.createInviteCode();
    const token = createToken();
    const now = Date.now();

    const participant = {
      participantId,
      token,
      displayName: normalizeDisplayName(displayName),
      joinedAt: now,
      lastHeartbeatAt: now,
      lastRemoteAddress: null,
      location: null,
      socket: null,
      removalReason: null
    };

    const room = {
      roomId,
      inviteCode,
      createdAt: now,
      hostParticipantId: participantId,
      participants: new Map([[participantId, participant]])
    };

    this.rooms.set(roomId, room);
    this.inviteCodeToRoomId.set(inviteCode, roomId);

    await this.persistence.persistRoom(room);
    await this.persistence.persistParticipant(room, participant);

    return { room, participant };
  }

  async joinRoom(inviteCode, displayName) {
    const normalizedCode = String(inviteCode || '').trim().toUpperCase();
    const roomId = this.inviteCodeToRoomId.get(normalizedCode);

    if (!roomId) {
      throw new Error('邀请码不存在，请确认后重试。');
    }

    const room = this.rooms.get(roomId);

    if (!room) {
      this.inviteCodeToRoomId.delete(normalizedCode);
      throw new Error('房间不存在，请重新创建。');
    }

    if (room.participants.size >= this.config.runtime.maxParticipantsPerRoom) {
      throw new Error('房间人数已满。');
    }

    const participant = {
      participantId: createId('user'),
      token: createToken(),
      displayName: normalizeDisplayName(displayName),
      joinedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      lastRemoteAddress: null,
      location: null,
      socket: null,
      removalReason: null
    };

    room.participants.set(participant.participantId, participant);
    await this.persistence.persistParticipant(room, participant);
    await this.persistence.persistRoom(room);

    return { room, participant };
  }

  verifyParticipant(roomId, participantId, token) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return { room: null, participant: null, error: '房间不存在。' };
    }

    const participant = room.participants.get(participantId);

    if (!participant || participant.token !== token) {
      return { room: null, participant: null, error: '身份校验失败。' };
    }

    return { room, participant, error: null };
  }

  createSessionResponse(room, participant) {
    return {
      room: this.makePublicRoom(room),
      participants: this.getParticipantList(room),
      session: {
        roomId: room.roomId,
        inviteCode: room.inviteCode,
        participantId: participant.participantId,
        displayName: participant.displayName,
        token: participant.token
      }
    };
  }

  async markParticipantConnected(room, participant, remoteAddress) {
    participant.lastHeartbeatAt = Date.now();
    participant.lastRemoteAddress = remoteAddress || participant.lastRemoteAddress || null;
    await this.persistence.persistParticipant(room, participant);
  }

  async markParticipantDisconnected(room, participant, remoteAddress) {
    participant.socket = null;
    participant.location = null;
    participant.lastHeartbeatAt = Date.now();
    participant.lastRemoteAddress = remoteAddress || participant.lastRemoteAddress || null;
    await this.persistence.persistParticipant(room, participant);
  }

  async touchParticipant(room, participant, remoteAddress) {
    participant.lastHeartbeatAt = Date.now();
    participant.lastRemoteAddress = remoteAddress || participant.lastRemoteAddress || null;
    await this.persistence.persistParticipant(room, participant);
  }

  async clearParticipantLocation(room, participant, remoteAddress) {
    participant.location = null;
    participant.lastHeartbeatAt = Date.now();
    participant.lastRemoteAddress = remoteAddress || participant.lastRemoteAddress || null;
    await this.persistence.persistParticipant(room, participant);
  }

  async updateParticipantLocation(room, participant, rawLocation, remoteAddress) {
    const location = sanitizeLocation(rawLocation);

    if (!location) {
      return null;
    }

    participant.location = location;
    participant.lastHeartbeatAt = Date.now();
    participant.lastRemoteAddress = remoteAddress || participant.lastRemoteAddress || null;
    await this.persistence.persistParticipant(room, participant);
    return location;
  }

  async removeParticipant(room, participantId, details = {}) {
    const participant = room.participants.get(participantId);

    if (!participant) {
      return { removed: false, participant: null, roomClosed: false };
    }

    if (participant.socket && !participant.socket.destroyed) {
      participant.socket.__closing = true;
      participant.socket.end();
    }

    participant.socket = null;
    participant.lastHeartbeatAt = Date.now();
    participant.lastRemoteAddress = details.remoteAddress || participant.lastRemoteAddress || null;
    participant.location = null;
    participant.removalReason = details.reason || participant.removalReason || 'removed';

    room.participants.delete(participantId);
    await this.persistence.markParticipantRemoved(room, participant);

    let roomClosed = false;

    if (room.hostParticipantId === participantId) {
      const nextHost = room.participants.values().next();
      room.hostParticipantId = nextHost.done ? null : nextHost.value.participantId;
    }

    if (room.participants.size === 0) {
      roomClosed = true;
      this.inviteCodeToRoomId.delete(room.inviteCode);
      this.rooms.delete(room.roomId);
      await this.persistence.markRoomClosed(room);
    } else {
      await this.persistence.persistRoom(room);
    }

    return { removed: true, participant, roomClosed };
  }

  async cleanup(now, staleParticipantMs, roomIdleMs) {
    const updates = [];

    for (const room of Array.from(this.rooms.values())) {
      for (const participant of Array.from(room.participants.values())) {
        const hasSocket = Boolean(participant.socket && !participant.socket.destroyed);

        if (hasSocket && now - participant.lastHeartbeatAt > staleParticipantMs) {
          participant.socket.__closing = true;
          participant.socket.destroy();
          continue;
        }

        if (!hasSocket && now - participant.lastHeartbeatAt > staleParticipantMs) {
          const result = await this.removeParticipant(room, participant.participantId, {
            reason: 'connection_timeout',
            remoteAddress: participant.lastRemoteAddress
          });

          updates.push({
            roomId: room.roomId,
            inviteCode: room.inviteCode,
            removed: result.removed,
            participantId: participant.participantId,
            remoteAddress: participant.lastRemoteAddress,
            reason: 'connection_timeout'
          });
        }
      }

      if (room.participants.size === 0 && now - room.createdAt > roomIdleMs) {
        this.inviteCodeToRoomId.delete(room.inviteCode);
        this.rooms.delete(room.roomId);
        await this.persistence.markRoomClosed(room);
      }
    }

    return updates;
  }

  getHealthPayload() {
    return {
      ok: true,
      rooms: this.rooms.size,
      participants: this.totalParticipantCount(),
      now: Date.now(),
      ...this.persistence.getHealthDetails()
    };
  }
}

function createPersistence(config) {
  if (config.storage.driver === 'mysql') {
    return new MysqlPersistence(config.storage.mysql);
  }

  return new MemoryPersistence();
}

function createStateStore(config) {
  return new LiveStateStore(config);
}

module.exports = {
  createStateStore
};
