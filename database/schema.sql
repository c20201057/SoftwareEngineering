CREATE DATABASE IF NOT EXISTS campus_gather
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE campus_gather;

CREATE TABLE users (
  id VARCHAR(32) PRIMARY KEY,
  student_no VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  nickname VARCHAR(64) NOT NULL,
  role ENUM('student', 'admin', 'venue_admin') NOT NULL DEFAULT 'student',
  auth_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
  credit_score INT NOT NULL DEFAULT 100,
  status ENUM('active', 'muted', 'limited', 'banned') NOT NULL DEFAULT 'active',
  tags JSON NULL,
  contact VARCHAR(128) NULL,
  auth_submission_name VARCHAR(64) NULL,
  auth_submission_student_no VARCHAR(32) NULL,
  auth_submission_contact VARCHAR(128) NULL,
  auth_submission_note VARCHAR(255) NULL,
  auth_submitted_at DATETIME NULL,
  auth_review_reason VARCHAR(255) NULL,
  auth_reviewed_at DATETIME NULL,
  status_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  INDEX idx_users_role_status (role, status),
  INDEX idx_users_auth_status (auth_status)
) ENGINE=InnoDB;

CREATE TABLE game_libs (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(32) NOT NULL,
  min_players INT NOT NULL,
  max_players INT NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 120,
  difficulty VARCHAR(32) NOT NULL DEFAULT '未标注',
  description TEXT NULL,
  tags JSON NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  INDEX idx_game_libs_type_status (type, status),
  CHECK (min_players > 0),
  CHECK (max_players >= min_players)
) ENGINE=InnoDB;

CREATE TABLE game_sessions (
  id VARCHAR(32) PRIMARY KEY,
  host_id VARCHAR(32) NOT NULL,
  game_id VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  description TEXT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  location VARCHAR(255) NOT NULL,
  max_members INT NOT NULL,
  current_members INT NOT NULL DEFAULT 1,
  min_credit_required INT NOT NULL DEFAULT 80,
  join_mode ENUM('manual', 'direct') NOT NULL DEFAULT 'manual',
  status ENUM('recruiting', 'full', 'finished', 'cancelled') NOT NULL DEFAULT 'recruiting',
  venue_status ENUM('none', 'pending', 'approved', 'rejected') NOT NULL DEFAULT 'none',
  cancel_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  CONSTRAINT fk_sessions_host FOREIGN KEY (host_id) REFERENCES users(id),
  CONSTRAINT fk_sessions_game FOREIGN KEY (game_id) REFERENCES game_libs(id),
  INDEX idx_sessions_status_start (status, start_time),
  INDEX idx_sessions_game_start (game_id, start_time),
  INDEX idx_sessions_host (host_id),
  CHECK (end_time > start_time),
  CHECK (max_members >= current_members)
) ENGINE=InnoDB;

CREATE TABLE session_applications (
  id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL,
  applicant_id VARCHAR(32) NOT NULL,
  message VARCHAR(500) NULL,
  status ENUM('pending', 'approved', 'rejected', 'withdrawn') NOT NULL DEFAULT 'pending',
  apply_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  review_time DATETIME NULL,
  review_reason VARCHAR(255) NULL,
  CONSTRAINT fk_applications_session FOREIGN KEY (session_id) REFERENCES game_sessions(id),
  CONSTRAINT fk_applications_applicant FOREIGN KEY (applicant_id) REFERENCES users(id),
  INDEX idx_applications_session_status (session_id, status),
  INDEX idx_applications_applicant_status (applicant_id, status)
) ENGINE=InnoDB;

CREATE TABLE session_members (
  id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  member_role ENUM('host', 'player', 'dm') NOT NULL DEFAULT 'player',
  join_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checkin_status ENUM('pending', 'checked_in', 'absent') NOT NULL DEFAULT 'pending',
  CONSTRAINT fk_members_session FOREIGN KEY (session_id) REFERENCES game_sessions(id),
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uk_session_user (session_id, user_id),
  INDEX idx_members_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE venues (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  location VARCHAR(255) NOT NULL,
  capacity INT NOT NULL,
  manager_id VARCHAR(32) NOT NULL,
  available_time VARCHAR(255) NOT NULL,
  open_rules TEXT NULL,
  status ENUM('active', 'maintenance', 'closed') NOT NULL DEFAULT 'active',
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  CONSTRAINT fk_venues_manager FOREIGN KEY (manager_id) REFERENCES users(id),
  INDEX idx_venues_manager_status (manager_id, status),
  CHECK (capacity > 0)
) ENGINE=InnoDB;

CREATE TABLE venue_reservations (
  id VARCHAR(32) PRIMARY KEY,
  venue_id VARCHAR(32) NOT NULL,
  session_id VARCHAR(32) NOT NULL,
  applicant_id VARCHAR(32) NOT NULL,
  reviewer_id VARCHAR(32) NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  review_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  CONSTRAINT fk_reservations_venue FOREIGN KEY (venue_id) REFERENCES venues(id),
  CONSTRAINT fk_reservations_session FOREIGN KEY (session_id) REFERENCES game_sessions(id),
  CONSTRAINT fk_reservations_applicant FOREIGN KEY (applicant_id) REFERENCES users(id),
  CONSTRAINT fk_reservations_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id),
  INDEX idx_reservations_venue_time_status (venue_id, start_time, end_time, status),
  INDEX idx_reservations_session (session_id),
  CHECK (end_time > start_time)
) ENGINE=InnoDB;

CREATE TABLE reviews (
  id VARCHAR(32) PRIMARY KEY,
  session_id VARCHAR(32) NOT NULL,
  reviewer_id VARCHAR(32) NOT NULL,
  target_user_id VARCHAR(32) NOT NULL,
  score INT NOT NULL,
  content TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_session FOREIGN KEY (session_id) REFERENCES game_sessions(id),
  CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id),
  CONSTRAINT fk_reviews_target FOREIGN KEY (target_user_id) REFERENCES users(id),
  UNIQUE KEY uk_review_once (session_id, reviewer_id, target_user_id),
  CHECK (score BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE TABLE complaints (
  id VARCHAR(32) PRIMARY KEY,
  reporter_id VARCHAR(32) NOT NULL,
  target_user_id VARCHAR(32) NOT NULL,
  session_id VARCHAR(32) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  evidence TEXT NULL,
  status ENUM('pending', 'accepted', 'need_more', 'rejected', 'finished') NOT NULL DEFAULT 'pending',
  result TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_by VARCHAR(32) NULL,
  handled_at DATETIME NULL,
  CONSTRAINT fk_complaints_reporter FOREIGN KEY (reporter_id) REFERENCES users(id),
  CONSTRAINT fk_complaints_target FOREIGN KEY (target_user_id) REFERENCES users(id),
  CONSTRAINT fk_complaints_session FOREIGN KEY (session_id) REFERENCES game_sessions(id),
  CONSTRAINT fk_complaints_handler FOREIGN KEY (handled_by) REFERENCES users(id),
  INDEX idx_complaints_status_time (status, created_at),
  INDEX idx_complaints_reporter (reporter_id),
  INDEX idx_complaints_target (target_user_id)
) ENGINE=InnoDB;

CREATE TABLE credit_records (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  session_id VARCHAR(32) NULL,
  complaint_id VARCHAR(32) NULL,
  change_value INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_credit_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_credit_session FOREIGN KEY (session_id) REFERENCES game_sessions(id),
  CONSTRAINT fk_credit_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id),
  INDEX idx_credit_user_time (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  content TEXT NOT NULL,
  related_type VARCHAR(64) NULL,
  related_id VARCHAR(32) NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_notifications_user_time (user_id, created_at),
  INDEX idx_notifications_unread (user_id, read_at)
) ENGINE=InnoDB;

CREATE TABLE admin_logs (
  id VARCHAR(32) PRIMARY KEY,
  operator_id VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(32) NOT NULL,
  result VARCHAR(64) NOT NULL,
  remark TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_logs_operator_time (operator_id, created_at),
  INDEX idx_admin_logs_object (object_type, object_id)
) ENGINE=InnoDB;
