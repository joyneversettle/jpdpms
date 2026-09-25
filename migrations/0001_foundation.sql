PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE hotels (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  legal_name TEXT,
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  country TEXT NOT NULL DEFAULT 'India',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, code),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
);

CREATE INDEX idx_hotels_org ON hotels(organization_id);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, name),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, email),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE RESTRICT,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
);

CREATE INDEX idx_users_hotel ON users(hotel_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  hotel_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata_json TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_org_created ON audit_logs(organization_id, created_at);
CREATE INDEX idx_audit_hotel_created ON audit_logs(hotel_id, created_at);

INSERT INTO permissions (id, key, description) VALUES
('perm_dashboard_view','dashboard.view','View the PMS dashboard'),
('perm_users_manage','users.manage','Create, edit, disable and manage users'),
('perm_roles_manage','roles.manage','Manage roles and permissions'),
('perm_hotel_manage','hotel.manage','Manage hotel profile and setup'),
('perm_audit_view','audit.view','View audit logs');

CREATE TRIGGER users_org_hotel_consistency
BEFORE INSERT ON users
WHEN (SELECT organization_id FROM hotels WHERE id = NEW.hotel_id) != NEW.organization_id
BEGIN
  SELECT RAISE(ABORT, 'hotel does not belong to organization');
END;

CREATE TRIGGER users_org_role_consistency
BEFORE INSERT ON users
WHEN (SELECT organization_id FROM roles WHERE id = NEW.role_id) != NEW.organization_id
BEGIN
  SELECT RAISE(ABORT, 'role does not belong to organization');
END;