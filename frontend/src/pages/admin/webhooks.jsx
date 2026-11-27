import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import RequireAdmin from "../../components/RequireAdmin";
import PageHero from "../../components/PageHero";
import { useAbortController } from "../../hooks/useAbortController";

function WebhookDeliveryLog() {
  const { signal } = useAbortController();
  const [items, setItems] = useState(null);
  const [retrying, setRetrying] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/webhook-deliveries?limit=50", { signal });
    if (!response.ok) throw new Error("Could not load webhook deliveries.");
    setItems((await response.json()).items);
  }, [signal]);

  useEffect(() => {
    load().catch((err) => {
      if (err.name !== "AbortError") setError(err.message);
    });
  }, [load]);

  async function retry(id) {
    setRetrying(id);
    setError("");
    try {
      const response = await fetch(`/api/webhook-deliveries/${encodeURIComponent(id)}/replay`, {
        method: "POST",
        signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not retry this delivery.");
      if (!result.success) setError("The receiving endpoint rejected the retry or could not be reached.");
      await load();
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      if (!signal?.aborted) setRetrying(null);
    }
  }

  return (
    <main className="container">
      <PageHero title="Webhook delivery log" />
      <Link href="/webhooks">Manage webhook endpoints</Link>
      {error && <p role="alert">{error}</p>}
      {!items && !error && <p role="status">Loading deliveries…</p>}
      {items?.length === 0 && <p>No deliveries in the retained history.</p>}
      {items?.length > 0 && (
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Time</th><th scope="col">Event</th><th scope="col">Status</th>
                <th scope="col">HTTP response</th><th scope="col">Latency</th>
                <th scope="col">Attempt</th><th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>{item.event}</td>
                  <td>{item.success ? "Delivered" : item.error || "Failed"}</td>
                  <td>{item.statusCode ?? "—"}</td>
                  <td>{item.durationMs == null ? "—" : `${item.durationMs} ms`}</td>
                  <td>{item.attemptCount}</td>
                  <td>{!item.success && (
                    <button type="button" disabled={retrying !== null} onClick={() => retry(item._id)}>
                      {retrying === item._id ? "Retrying…" : "Retry"}
                    </button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default function AdminWebhooks() {
  return <RequireAdmin><WebhookDeliveryLog /></RequireAdmin>;
}
