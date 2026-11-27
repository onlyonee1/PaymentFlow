import { SITE_ORIGIN, schoolPath } from "../../../config/seo";
import { getPublicSchools } from "../../../services/publicSchools";

export default async function sitemap(req, res) {
  let schools;
  try {
    schools = await getPublicSchools();
  } catch {
    return res.status(503).end();
  }

  const paths = ["/", "/pay-fees", ...schools.flatMap(({ slug }) => [
    schoolPath("schools", slug),
    schoolPath("pay", slug),
  ])];
  const locations = paths.map((path) => {
    const url = new URL(path, SITE_ORIGIN).href.replaceAll("&", "&amp;").replaceAll("'", "&apos;");
    return `  <url><loc>${url}</loc></url>`;
  });
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  return res.send([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locations,
    "</urlset>",
  ].join("\n"));
}
