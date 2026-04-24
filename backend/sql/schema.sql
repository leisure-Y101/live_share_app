CREATE TABLE IF NOT EXISTS rooms (
  room_id VARCHAR(48) NOT NULL PRIMARY KEY,
  invite_code CHAR(6) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  host_participant_id VARCHAR(48) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  closed_at BIGINT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_rooms_status ON rooms (status, updated_at);
CREATE INDEX idx_participants_room_active ON participants (room_id, removed_at);
CREATE INDEX idx_participants_heartbeat ON participants (last_heartbeat_at);
