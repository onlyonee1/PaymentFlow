import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE_ORIGIN } from "../../../config/seo";

export default async function robots(req, res) {
  const template = await readFile(path.join(process.cwd(), "public/robots.txt"), "utf8");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(template.replace(/^Sitemap: .*$/m, `Sitemap: ${SITE_ORIGIN}/sitemap.xml`));
}
