import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { sqlite } from "../db";
import chalk from "chalk";
import { createHash } from "crypto";

const TOKEN = process.env.NEWSBOT_DISCORD_TOKEN!;
const CLIENT_ID = process.env.NEWSBOT_CLIENT_ID!;
const CHANNEL_NEWS = process.env.NEWSBOT_CHANNEL_NEWS!;
const CHANNEL_SECURITY = process.env.NEWSBOT_CHANNEL_SECURITY!;
const CHANNEL_CVES = process.env.NEWSBOT_CHANNEL_CVES!;
const FETCH_INTERVAL_MS = 30 * 60 * 1000;

// ─── Commands ───
const commands = [
  new SlashCommandBuilder().setName("news").setDescription("Últimas noticias tech (top 5)"),
  new SlashCommandBuilder().setName("seguridad").setDescription("Últimas noticias de seguridad (top 5)"),
  new SlashCommandBuilder().setName("cves").setDescription("Últimos CVEs del stack (top 5)"),
  new SlashCommandBuilder().setName("newsbot").setDescription("Cómo funciona este bot"),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

function itemHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").substring(0, 32);
}

function isNew(url: string): boolean {
  const row = sqlite.query("SELECT id FROM items WHERE id = ?").get(itemHash(url));
  return !row;
}

function markSeen(url: string, type: string, title: string, summary: string, source: string, severity: string | null, published?: number, image?: string, author?: string) {
  sqlite.query(
    `INSERT OR IGNORE INTO items (id, type, title, url, summary, image, author, source, severity, published, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(itemHash(url), type, title, url, summary, image ?? null, author ?? null, source, severity, published ?? null, Date.now());
}

function newsEmbed(item: any) {
  const embed = new EmbedBuilder()
    .setTitle(item.title.substring(0, 256))
    .setURL(item.url)
    .setColor(0x3498db)
    .setTimestamp(item.published ? new Date(item.published) : new Date());

  // Descripción: si hay summary real la mostramos; si no (HN), mostramos
  // los stats (puntos/comentarios) para mantener la estructura uniforme.
  if (item.summary && !item.summary.startsWith("Article URL:")) {
    embed.setDescription(item.summary.substring(0, 400));
  } else if (item.points || item.comments) {
    const stats = [item.points ? `⬆️ **${item.points}** puntos` : "", item.comments ? `💬 **${item.comments}** comentarios` : ""].filter(Boolean).join("\n");
    if (stats) embed.setDescription(`📈 ${stats}`);
  }

  // Footer uniforme: fuente + autor (si existe)
  const footer = `📰 ${item.source}${item.author ? ` • ✍️ ${item.author}` : ""}`;
  embed.setFooter({ text: footer.substring(0, 200) });

  if (item.image) {
    embed.setImage(item.image);
  }

  return embed;
}

const CVS_COLORS: Record<string, number> = {
  CRITICAL: 0xe74c3c,
  HIGH: 0xf39c12,
  MEDIUM: 0xf1c40f,
  LOW: 0x2ecc71,
  UNKNOWN: 0x95a5a6,
};

function cveEmbed(item: any) {
  const embed = new EmbedBuilder()
    .setTitle(item.id)
    .setURL(item.url)
    .setColor(CVS_COLORS[item.severity] || 0x95a5a6)
    .setFooter({ text: `🔴 ${item.severity} • ${item.source}` })
    .setTimestamp(item.published ? new Date(item.published) : new Date());

  if (item.summary) {
    embed.setDescription(item.summary.substring(0, 1000));
  }

  return embed;
}

// ─── Auto-fetch ───
async function autoFetch(client: Client) {
  console.log(chalk.dim("  Auto-fetching..."));
  const newsChannel = client.channels.cache.get(CHANNEL_NEWS);
  const securityChannel = client.channels.cache.get(CHANNEL_SECURITY);
  const cveChannel = client.channels.cache.get(CHANNEL_CVES);

  // News + Security
  if ((newsChannel && "send" in newsChannel) || (securityChannel && "send" in securityChannel)) {
    try {
      const { fetchNews } = await import("../fetcher/news");
      const items = await fetchNews();
      let sentNews = 0;
      let sentSec = 0;
      for (const item of items) {
        const target = item.type === "security" ? securityChannel : newsChannel;
        if (!target || !("send" in target)) continue;
        if (!isNew(item.url)) continue;
        markSeen(item.url, item.type, item.title, item.summary, item.source, null, item.published, item.image, item.author);
        await target.send({ embeds: [newsEmbed(item)] });
        if (item.type === "security") sentSec++;
        else sentNews++;
      }
      if (sentNews > 0) console.log(chalk.green(`  ✓ ${sentNews} noticias nuevas`));
      else console.log(chalk.dim("  Sin noticias nuevas"));
      if (sentSec > 0) console.log(chalk.green(`  ✓ ${sentSec} noticias de seguridad nuevas`));
    } catch (err: any) {
      console.error(chalk.red(`  ✗ News send failed: ${err.message}`));
    }
  }

  // CVEs
  if (cveChannel && "send" in cveChannel) {
    const { fetchCves } = await import("../fetcher/cves");
    try {
      const items = await fetchCves(2);
      let sent = 0;
      for (const item of items) {
        if (!isNew(item.url)) continue;
        markSeen(item.url, "cve", item.title, item.summary, item.source, item.severity, item.published);
        await cveChannel.send({ embeds: [cveEmbed(item)] });
        sent++;
        if (sent >= 5) break;
      }
      if (sent > 0) console.log(chalk.green(`  ✓ ${sent} CVEs nuevos`));
      else console.log(chalk.dim("  Sin CVEs nuevos"));
    } catch (err: any) {
      console.error(chalk.red(`  ✗ CVE fetch failed: ${err.message}`));
    }
  }
}

// ─── Handlers ───
async function handleNews(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const rows = sqlite.query(
    "SELECT * FROM items WHERE type = 'news' ORDER BY published DESC LIMIT 5"
  ).all();
  if (rows.length === 0) {
    await interaction.editReply("Todavía no hay noticias. Espera el próximo auto-fetch.");
    return;
  }
  await interaction.editReply({ content: "📰 **Últimas noticias:**", embeds: rows.map(newsEmbed) });
}

async function handleSeguridad(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const rows = sqlite.query(
    "SELECT * FROM items WHERE type = 'security' ORDER BY published DESC LIMIT 5"
  ).all();
  if (rows.length === 0) {
    await interaction.editReply("Todavía no hay noticias de seguridad. Espera el próximo auto-fetch.");
    return;
  }
  await interaction.editReply({ content: "🛡️ **Últimas noticias de seguridad:**", embeds: rows.map(newsEmbed) });
}

async function handleCves(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const rows = sqlite.query(
    "SELECT * FROM items WHERE type = 'cve' ORDER BY published DESC LIMIT 5"
  ).all();
  if (rows.length === 0) {
    await interaction.editReply("Todavía no hay CVEs. Espera el próximo auto-fetch.");
    return;
  }
  await interaction.editReply({ content: "🔴 **Últimos CVEs del stack:**", embeds: rows.map(cveEmbed) });
}

async function handleInfo(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("📡 Cómo funciona NewsBot")
    .setColor(0x2ecc71)
    .setDescription("Te mantengo al día con noticias tech y vulnerabilidades de tu stack.")
    .addFields(
      {
        name: "📰 Fuentes de noticias",
        value: [
          "• Hacker News (frontpage)",
          "• Go Blog, Rust Blog, React Blog",
          "• Smashing Magazine, CSS-Tricks",
          "• freeCodeCamp",
        ].join("\n"),
      },
      {
        name: "🛡️ Noticias de seguridad",
        value: [
          "• The Hacker News",
          "• Bleeping Computer",
          "Filtraciones, ransomware y brechas de datos.",
        ].join("\n"),
      },
      {
        name: "🔴 Vulnerabilidades (CVE)",
        value: [
          "Uso la API oficial de NVD (NIST).",
          "Filtro solo CVEs que tocan tu stack:",
          "JS/TS, React, Node, Python, Rust, Go, Java, C#, C/C++,",
          "PostgreSQL, MySQL, SQLite, Linux, Docker, Vercel, Cloudflare, Godot.",
        ].join("\n"),
      },
      {
        name: "⚙️ Comandos",
        value: [
          "`/news` — Últimas noticias",
          "`/seguridad` — Últimas noticias de seguridad",
          "`/cves` — Últimos CVEs",
          "`/newsbot` — Esta información",
        ].join("\n"),
      },
    )
    .setFooter({ text: "Auto-fetch cada 30 minutos" });

  await interaction.reply({ embeds: [embed] });
}

// ─── Main ───
async function main() {
  console.log(chalk.bold("\n  newsbot\n"));

  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: commands.map((c) => c.toJSON()),
  });
  console.log(chalk.green("  ✓ Slash commands registered"));

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

  client.once(Events.ClientReady, (c) => {
    console.log(chalk.green(`  ✓ Bot online: ${c.user.tag}`));
    for (const guild of c.guilds.cache.values()) {
      rest.put(Routes.applicationGuildCommands(CLIENT_ID, guild.id), {
        body: commands.map((cmd) => cmd.toJSON()),
      })
        .then(() => console.log(chalk.dim(`  ✓ Commands synced to guild ${guild.name}`)))
        .catch((err) => console.error(chalk.red(`  ✗ Guild sync failed: ${err}`)));
    }
    autoFetch(client);
    setInterval(() => autoFetch(client), FETCH_INTERVAL_MS);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      switch (interaction.commandName) {
        case "news": await handleNews(interaction); break;
        case "seguridad": await handleSeguridad(interaction); break;
        case "cves": await handleCves(interaction); break;
        case "newsbot": await handleInfo(interaction); break;
      }
    } catch (err) {
      console.error(chalk.red(`  Error: ${err}`));
      const reply = { content: "❌ Error ejecutando el comando.", ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
      else await interaction.reply(reply);
    }
  });

  await client.login(TOKEN);
}

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${err}`));
  process.exit(1);
});
