export const SITE_ORIGIN = new URL(
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
).origin;

export function schoolPath(section, slug) {
  return `/${section}/${encodeURIComponent(slug)}`;
}
