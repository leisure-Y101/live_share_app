'use strict';

const fs = require('fs');
const path = require('path');

function createAuditLogger(config) {
  const { dir, filePrefix, retentionDays } = config.audit;
  let lastPruneAt = 0;

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
  }

  function getLogPath(date = new Date()) {
    return path.join(dir, `${filePrefix}${date.toISOString().slice(0, 10)}.jsonl`);
  }

  function sanitizeDetails(details) {
    return Object.fromEntries(
      Object.entries(details)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 200) : value])
    );
  }

  function prune(now = Date.now()) {
    ensureDir();

    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

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

      fs.unlinkSync(path.join(dir, entry.name));
    }
  }

  function maybePrune(now = Date.now()) {
    if (now - lastPruneAt < 12 * 60 * 60 * 1000) {
      return;
    }

    lastPruneAt = now;

    try {
      prune(now);
    } catch (error) {
      console.error('Failed to prune audit logs:', error);
    }
  }

  function write(event, details = {}) {
    const entry = {
      at: new Date().toISOString(),
      event,
      ...sanitizeDetails(details)
    };

    maybePrune();

    try {
      ensureDir();
      fs.appendFileSync(getLogPath(), `${JSON.stringify(entry)}\n`);
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }
  }

  return {
    write,
    maybePrune
  };
}

module.exports = {
  createAuditLogger
};
