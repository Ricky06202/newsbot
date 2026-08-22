import Parser from "rss-parser";
import { sqlite } from "../db";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "newsbot/1.0" },
});

interface NewsItem {
  type: "news";
  title: string;
  url: string;
  summary: string;
  image?: string;
  source: string;
  author?: string;
  published?: number;
}

interface NewsSource {
  name: string;
  url: string;
  keywords?: string[]; // si está, solo deja items que matcheen alguna keyword
}

const NEWS_SOURCES: NewsSource[] = [
  {
    name: "Hacker News",
    url: "https://hnrss.org/frontpage",
  },
  {
    name: "Go Blog",
    url: "https://blog.golang.org/feed.atom",
    keywords: ["go", "golang"],
  },
  {
    name: "Rust Blog",
    url: "https://blog.rust-lang.org/feed.xml",
    keywords: ["rust"],
  },
  {
    name: "React Blog",
    url: "https://react.dev/feed.xml",
    keywords: ["react"],
  },
  {
    name: "Smashing Magazine",
    url: "https://www.smashingmagazine.com/feed/",
    keywords: ["react", "typescript", "javascript", "css", "frontend", "node", "tailwind", "accessibility"],
  },
  {
    name: "CSS-Tricks",
    url: "https://css-tricks.com/feed/",
    keywords: ["react", "typescript", "javascript", "css", "frontend", "tailwind", "node"],
  },
  {
    name: "freeCodeCamp",
    url: "https://www.freecodecamp.org/news/rss/",
    keywords: ["react", "typescript", "javascript", "python", "rust", "go", "node", "bash", "linux", "sql", "postgres"],
  },
];

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// Completa URLs de imagen relativas con el dominio del feed
function resolveImageUrl(src: string, feedUrl: string): string | undefined {
  if (src.startsWith("http")) return src;
  if (src.startsWith("/")) {
    try {
      const u = new URL(feedUrl);
      return `${u.origin}${src}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Extrae la primera <img> del HTML del contenido, si existe
function extractImage(html: string, feedUrl: string): string | undefined {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!match) return undefined;
  return resolveImageUrl(match[1], feedUrl);
}

// Limpia el HTML del snippet a texto plano
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Para Hacker News: extrae puntos y nº de comentarios del contenido
function extractHnStats(html: string): { points?: number; comments?: number } {
  const points = html.match(/Points:\s*(\d+)/i);
  const comments = html.match(/# Comments:\s*(\d+)/i);
  return {
    points: points ? parseInt(points[1]) : undefined,
    comments: comments ? parseInt(comments[1]) : undefined,
  };
}

export async function fetchNews(): Promise<NewsItem[]> {
  const all: NewsItem[] = [];
  let totalFiltered = 0;

  for (const source of NEWS_SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      let items = feed.items
        .map((item) => {
          const contentHtml = item.content || "";
          const snippet = (item.contentSnippet || stripHtml(contentHtml) || "").substring(0, 300);
          const isHN = source.name === "Hacker News";
          return {
            type: "news" as const,
            title: item.title || "",
            url: item.link || "",
            summary: snippet,
            image: extractImage(contentHtml, source.url),
            source: source.name,
            author: item.creator || item.author || undefined,
            published: item.isoDate ? new Date(item.isoDate).getTime() : undefined,
            ...(isHN ? extractHnStats(contentHtml) : {}),
          };
        })
        .filter((i) => i.title && i.url);

      if (source.keywords && source.keywords.length > 0) {
        const before = items.length;
        items = items.filter((i) => matchesKeywords(`${i.title} ${i.summary}`, source.keywords!));
        totalFiltered += before - items.length;
      }

      all.push(...items);
    } catch (err: any) {
      console.error(`  ✗ Failed ${source.name}: ${err.message}`);
    }
  }

  if (totalFiltered > 0) {
    console.log(`  ${totalFiltered} filtered by keywords`);
  }

  return all;
}
