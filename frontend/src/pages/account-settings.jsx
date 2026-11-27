import { useEffect, useState } from "react";
import RequireAdmin from "../components/RequireAdmin";
import { useAdminAuthContext } from "../hooks/AdminAuthContext";
import api from "../services/api";

function AccountSettings() {
  const { logout, userId } = useAdminAuthContext();
  const [sessions, setSessions] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api.get("/auth/sessions", { signal: controller.signal })
      .then(({ data }) => setSessions(data.sessions))
      .catch(() => {
        if (!controller.signal.aborted) {
          setSessions([]);
          setNotice("Could not load your sessions.");
        }
      });
    return () => controller.abort();
  }, []);

  async function changePassword(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      await api.post("/auth/change-password", {
        currentPassword: data.get("currentPassword"),
        newPassword: data.get("newPassword"),
      });
      await logout();
    } catch (error) {
      setNotice(error.response?.data?.error || "Could not change your password.");
      setBusy(false);
    }
  }

  async function revoke(session) {
    setBusy(true);
    setNotice("");
    try {
      await api.delete(`/auth/sessions/${encodeURIComponent(session.sessionId)}`);
      setSessions(items => items.filter(item => item.sessionId !== session.sessionId));
      if (session.current) await logout();
    } catch (error) {
      setNotice(error.response?.data?.error || "Could not revoke the session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <h1>Account settings</h1>
      {notice && <p role="alert">{notice}</p>}

      {userId !== "super_admin" && (
        <section aria-labelledby="password-heading">
          <h2 id="password-heading">Change password</h2>
          <form onSubmit={changePassword}>
            <p><label>Current password <input name="currentPassword" type="password" autoComplete="current-password" required /></label></p>
            <p><label>New password <input name="newPassword" type="password" autoComplete="new-password" minLength={8} required /></label></p>
            <button type="submit" disabled={busy}>Change password and sign out</button>
          </form>
        </section>
      )}

      <section aria-labelledby="session-heading">
        <h2 id="session-heading">Active sessions</h2>
        {sessions === null && <p role="status">Loading sessions…</p>}
        {sessions?.length === 0 && !notice && <p>No active sessions found.</p>}
        {sessions?.length > 0 && (
          <table>
            <thead>
              <tr><th>Device</th><th>IP address</th><th>Last active</th><th>Action</th></tr>
            </thead>
            <tbody>
              {sessions.map(session => (
                <tr key={session.sessionId}>
                  <td>{session.deviceInfo?.userAgent || "Unknown device"}{session.current && " (this session)"}</td>
                  <td>{session.deviceInfo?.ip || "Unknown"}</td>
                  <td>{session.lastUsed ? new Date(session.lastUsed).toLocaleString() : "Unknown"}</td>
                  <td><button type="button" disabled={busy} onClick={() => revoke(session)}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

export default function AccountSettingsPage() {
  return <RequireAdmin><AccountSettings /></RequireAdmin>;
}
