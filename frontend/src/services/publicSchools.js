export async function getPublicSchools() {
  const backend = process.env.BACKEND_PROXY_TARGET || "http://localhost:5000";
  const response = await fetch(new URL("/api/schools/public/directory", backend), {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`School directory returned HTTP ${response.status}`);
  return response.json();
}
