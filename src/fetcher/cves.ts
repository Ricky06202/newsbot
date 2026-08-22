interface CveItem {
  type: "cve";
  id: string;          // CVE-2026-12345
  title: string;       // CVE-ID + desc corta
  url: string;
  summary: string;
  source: string;
  severity: string;    // CRITICAL/HIGH/MEDIUM/LOW
  published?: number;
}

// CVEs relevantes al stack de Ricky: JS/TS, React, Node, Python, Rust, Go,
// Java, C#, C/C++, SQL, Linux, Docker, Godot, Vercel, Cloudflare, nginx, etc.
const STACK_KEYWORDS = [
  "typescript", "javascript", "node.js", "nodejs", "react", "next.js",
  "astro", "svelte", "hono", "express", "bun", "vercel", "cloudflare",
  "python", "fastapi", "django", "rust", "golang", "go ", "java", "c#",
  "blazor", "c++", "postgres", "postgresql", "mysql", "sqlite", "sql ",
  "linux", "docker", "nginx", "git", "tauri", "expo", "godot", "jwt",
  "oauth", "bash",
];

function matchesStack(text: string): boolean {
  const lower = text.toLowerCase();
  return STACK_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

export async function fetchCves(days = 2): Promise<CveItem[]> {
  const now = new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, ".000");
  const url =
    `https://services.nvd.nist.gov/rest/json/cves/2.0` +
    `?pubStartDate=${fmt(start)}&pubEndDate=${fmt(now)}` +
    `&resultsPerPage=200`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`NVD API HTTP ${res.status}`);
  const data = await res.json() as any;

  const vulns: CveItem[] = [];
  for (const entry of data.vulnerabilities ?? []) {
    const cve = entry.cve;
    const id = cve.id;
    const desc = cve.descriptions?.find((d: any) => d.lang === "en")?.value || "";

    // Solo nos interesan las que tocan el stack
    if (!matchesStack(`${id} ${desc}`)) continue;

    // Severidad base (CVSS 3.1 o 2.0)
    let severity = "UNKNOWN";
    const cvss = cve.metrics?.cvssMetricV31?.[0]?.cvssData ?? cve.metrics?.cvssMetricV2?.[0]?.cvssData;
    if (cvss) severity = cvss.baseSeverity ?? (cvss.baseScore >= 9 ? "CRITICAL" : cvss.baseScore >= 7 ? "HIGH" : cvss.baseScore >= 4 ? "MEDIUM" : "LOW");

    vulns.push({
      type: "cve",
      id,
      title: `${id} — ${desc.substring(0, 100)}`,
      url: `https://nvd.nist.gov/vuln/detail/${id}`,
      summary: desc.substring(0, 300),
      source: "NVD",
      severity,
      published: cve.published ? new Date(cve.published).getTime() : undefined,
    });
  }

  return vulns;
}
