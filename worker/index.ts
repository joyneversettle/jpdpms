interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PMS_BOOTSTRAP_SECRET?: string;
}

const SESSION_DAYS = 7;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    key,
    256
  );

  return `pbkdf2-sha256$210000$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText] = stored.split("$");
  if (algorithm !== "pbkdf2-sha256") return false;

  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64ToBytes(saltText), iterations, hash: "SHA-256" },
    key,
    256
  );

  const actual = new Uint8Array(bits);
  const expected = base64ToBytes(hashText);
  if (actual.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function newToken(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

function sessionCookie(token: string, maxAge: number): string {
  return `pms_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function currentUser(request: Request, env: Env) {
  const token = getCookie(request, "pms_session");
  if (!token) return null;

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id,
      s.expires_at,
      u.email,
      u.name,
      u.status AS user_status,
      u.organization_id,
      u.hotel_id,
      r.name AS role_name,
      h.name AS hotel_name,
      h.code AS hotel_code
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN roles r ON r.id = u.role_id
    JOIN hotels h ON h.id = u.hotel_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND u.status = 'active'
  `).bind(tokenHash, nowIso()).first<{
    session_id: string;
    user_id: string;
    expires_at: string;
    email: string;
    name: string;
    user_status: string;
    organization_id: string;
    hotel_id: string;
    role_name: string;
    hotel_name: string;
    hotel_code: string;
  }>();

  return row ?? null;
}

async function audit(
  env: Env,
  args: {
    organizationId: string;
    hotelId?: string | null;
    userId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: unknown;
  }
) {
  await env.DB.prepare(`
    INSERT INTO audit_logs
      (id, organization_id, hotel_id, user_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id("aud"),
    args.organizationId,
    args.hotelId ?? null,
    args.userId ?? null,
    args.action,
    args.entityType ?? null,
    args.entityId ?? null,
    args.metadata === undefined ? null : JSON.stringify(args.metadata),
    nowIso()
  ).run();
}

async function bootstrap(request: Request, env: Env): Promise<Response> {
  if (!env.PMS_BOOTSTRAP_SECRET) return json({ error: "Bootstrap is disabled." }, 404);

  const secret = request.headers.get("X-PMS-Bootstrap-Secret");
  if (!secret || secret !== env.PMS_BOOTSTRAP_SECRET) return json({ error: "Unauthorized." }, 401);

  const body = await request.json() as {
    organizationName?: string;
    hotelName?: string;
    hotelCode?: string;
    adminName?: string;
    adminEmail?: string;
    adminPassword?: string;
  };

  const organizationName = body.organizationName?.trim();
  const hotelName = body.hotelName?.trim();
  const hotelCode = body.hotelCode?.trim().toUpperCase();
  const adminName = body.adminName?.trim();
  const adminEmail = body.adminEmail?.trim().toLowerCase();
  const adminPassword = body.adminPassword ?? "";

  if (!organizationName || !hotelName || !hotelCode || !adminName || !adminEmail) {
    return json({ error: "All organization, hotel and admin fields are required." }, 400);
  }

  if (!/^[A-Z0-9][A-Z0-9_-]{1,15}$/.test(hotelCode)) {
    return json({ error: "Hotel code must be 2-16 characters: A-Z, 0-9, _ or -." }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return json({ error: "Invalid admin email." }, 400);
  }

  if (adminPassword.length < 12) {
    return json({ error: "Admin password must be at least 12 characters." }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM organizations LIMIT 1").first<{ id: string }>();
  if (existing) return json({ error: "PMS has already been bootstrapped." }, 409);

  const now = nowIso();
  const organizationId = id("org");
  const hotelId = id("hot");
  const roleId = id("rol");
  const userId = id("usr");
  const passwordHash = await hashPassword(adminPassword);

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).bind(organizationId, organizationName, `${organizationId}-${hotelCode.toLowerCase()}`, now, now),

      env.DB.prepare(`
        INSERT INTO hotels
          (id, organization_id, name, code, country, timezone, currency, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'India', 'Asia/Kolkata', 'INR', 'active', ?, ?)
      `).bind(hotelId, organizationId, hotelName, hotelCode, now, now),

      env.DB.prepare(`
        INSERT INTO roles (id, organization_id, name, description, is_system, created_at)
        VALUES (?, ?, 'Owner', 'Full PMS access for the organization owner.', 1, ?)
      `).bind(roleId, organizationId, now),

      env.DB.prepare(`
        INSERT INTO users
          (id, organization_id, hotel_id, role_id, email, name, password_hash, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(userId, organizationId, hotelId, roleId, adminEmail, adminName, passwordHash, now, now),
    ]);

    const permissions = await env.DB.prepare("SELECT id FROM permissions").all<{ id: string }>();
    for (const permission of permissions.results) {
      await env.DB.prepare(`
        INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)
      `).bind(roleId, permission.id).run();
    }

    await audit(env, {
      organizationId,
      hotelId,
      userId,
      action: "organization.bootstrap",
      entityType: "organization",
      entityId: organizationId,
    });

    return json({ ok: true, organizationId, hotelId, userId }, 201);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Bootstrap failed.",
    }, 500);
  }
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password) return json({ error: "Email and password are required." }, 400);

  const user = await env.DB.prepare(`
    SELECT id, organization_id, hotel_id, role_id, email, name, password_hash
    FROM users
    WHERE email = ? AND status = 'active'
  `).bind(email).first<{
    id: string;
    organization_id: string;
    hotel_id: string;
    role_id: string;
    email: string;
    name: string;
    password_hash: string;
  }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: "Invalid email or password." }, 401);
  }

  const token = newToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString();

  await env.DB.prepare(`
    INSERT INTO sessions
      (id, user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id("ses"), user.id, tokenHash, expires, now.toISOString(), now.toISOString()).run();

  await env.DB.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?")
    .bind(now.toISOString(), now.toISOString(), user.id).run();

  await audit(env, {
    organizationId: user.organization_id,
    hotelId: user.hotel_id,
    userId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
  });

  const response = json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie(token, SESSION_DAYS * 86400));
  return response;
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = getCookie(request, "pms_session");
  if (token) {
    const tokenHash = await sha256(token);
    await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?")
      .bind(nowIso(), tokenHash).run();
  }

  const response = json({ ok: true });
  response.headers.set("Set-Cookie", sessionCookie("", 0));
  return response;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, service: "shangrilas-pms-api", timestamp: nowIso() });
    }

    if (request.method === "POST" && url.pathname === "/api/bootstrap") {
      return bootstrap(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      return login(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      return logout(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/me") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Authentication required." }, 401);

      return json({
        user: {
          id: user.user_id,
          email: user.email,
          name: user.name,
          role: user.role_name,
        },
        hotel: {
          id: user.hotel_id,
          name: user.hotel_name,
          code: user.hotel_code,
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;