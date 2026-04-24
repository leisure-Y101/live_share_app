'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  host: '0.0.0.0',
  port: 8787,
  staleParticipantMs: 35_000,
  roomIdleMs: 6 * 60 * 60 * 1000,
  maxParticipantsPerRoom: 50,
  inviteCodeLength: 6,
  auditLogRetentionDays: 30,
  mysqlPort: 3306,
  mysqlConnectionLimit: 10,
  dbAutoMigrate: true
};

function loadEnvFile(filePath = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readNumber(name, fallbackValue) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function readBoolean(name, fallbackValue) {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallbackValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function createConfig() {
  loadEnvFile();

  return {
    server: {
      host: process.env.HOST || DEFAULTS.host,
      port: readNumber('PORT', DEFAULTS.port)
    },
    runtime: {
      staleParticipantMs: readNumber('STALE_PARTICIPANT_MS', DEFAULTS.staleParticipantMs),
      roomIdleMs: readNumber('ROOM_IDLE_MS', DEFAULTS.roomIdleMs),
      maxParticipantsPerRoom: readNumber('MAX_PARTICIPANTS_PER_ROOM', DEFAULTS.maxParticipantsPerRoom),
      inviteCodeLength: readNumber('INVITE_CODE_LENGTH', DEFAULTS.inviteCodeLength)
    },
    audit: {
      retentionDays: readNumber('AUDIT_LOG_RETENTION_DAYS', DEFAULTS.auditLogRetentionDays),
      dir: path.join(__dirname, '..', 'logs'),
      filePrefix: 'security-audit-'
    },
    storage: {
      driver: String(process.env.STORAGE_DRIVER || 'memory').trim().toLowerCase(),
      mysql: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: readNumber('DB_PORT', DEFAULTS.mysqlPort),
        user: process.env.DB_USER || '',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || '',
        charset: process.env.DB_CHARSET || 'utf8mb4',
        connectionLimit: readNumber('DB_CONNECTION_LIMIT', DEFAULTS.mysqlConnectionLimit),
        autoMigrate: readBoolean('DB_AUTO_MIGRATE', DEFAULTS.dbAutoMigrate)
      }
    }
  };
}

module.exports = {
  createConfig
};
