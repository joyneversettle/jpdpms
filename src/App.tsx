import { useEffect, useState } from "react";

type Health = {
  ok: boolean;
  service: string;
  timestamp: string;
};

type Me = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  hotel: {
    id: string;
    name: string;
    code: string;
  };
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }
  return data;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Health>("/api/health")
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "API error"));

    api<Me>("/api/me")
      .then(setMe)
      .catch(() => {
        // Not logged in yet; this is expected on a fresh installation.
      });
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">SHANGRILAS BEACH RESORT</p>
          <h1>PMS Foundation</h1>
          <p className="muted">
            Production-oriented foundation for the hotel management system.
          </p>
        </div>
        <div className="status">
          <span className={health?.ok ? "dot online" : "dot"} />
          {health?.ok ? "API Online" : "Checking API…"}
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Foundation</h2>
          <ul>
            <li>Multi-tenant organization + hotel structure</li>
            <li>Users, roles and permissions</li>
            <li>Secure session-token model</li>
            <li>Audit log foundation</li>
            <li>D1 migration-based database</li>
          </ul>
        </article>

        <article className="card">
          <h2>Next module</h2>
          <p>Hotel Setup & Room Inventory</p>
          <p className="muted">
            Room types, rooms, floors, amenities, rate plans and meal plans will be added
            only after this foundation is validated.
          </p>
        </article>

        <article className="card">
          <h2>Current status</h2>
          {me ? (
            <p>Signed in as {me.user.name} ({me.user.role}).</p>
          ) : (
            <p className="muted">No active session. Complete the one-time admin bootstrap.</p>
          )}
          {error && <p className="error">{error}</p>}
        </article>
      </section>
    </main>
  );
}