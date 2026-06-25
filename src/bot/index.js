require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
} = require("discord.js");

const { initDatabase } = require("../db/schema");
const { createQueries } = require("../db/queries");
const { onGuildMemberAdd } = require("./events/guildMemberAdd");
const { onGuildMemberRemove } = require("./events/guildMemberRemove");
const { onMessageCreate } = require("./events/messageCreate");

async function buildInviteCache(guild, invitesCache, queries) {
  try {
    const invites = await guild.invites.fetch();
    const cache = new Map();
    const snapshot = [];

    for (const invite of invites.values()) {
      const uses = invite.uses || 0;
      cache.set(invite.code, uses);
      snapshot.push({
        code: invite.code,
        inviterId: invite.inviter ? invite.inviter.id : null,
        uses,
      });
    }

    invitesCache.set(guild.id, cache);
    queries.updateInviteSnapshot(snapshot);
  } catch (error) {
    console.warn("Invite cache init failed:", error.message);
  }
}

async function startBot(options = {}) {
  const token = options.token || process.env.DISCORD_TOKEN;
  const guildId = options.guildId || process.env.GUILD_ID;

  const db = options.db || initDatabase(process.env.DB_PATH);
  const queries = options.queries || createQueries(db);
  const invitesCache = new Map();

  if (!token) {
    throw new Error("DISCORD_TOKEN is required to start the bot");
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildInvites,
    ],
    partials: [Partials.Channel],
  });

  const context = {
    queries,
    guildId,
    invitesCache,
  };

  client.once("ready", async () => {
    console.log(`Bot logged in as ${client.user.tag}`);

    const guild = guildId
      ? await client.guilds.fetch(guildId).catch(() => null)
      : client.guilds.cache.first();

    if (guild) {
      await buildInviteCache(guild, invitesCache, queries);
    }
  });

  client.on("guildMemberAdd", async (member) => {
    await onGuildMemberAdd(member, context);
  });

  client.on("guildMemberRemove", (member) => {
    onGuildMemberRemove(member, context);
  });

  client.on("messageCreate", (message) => {
    onMessageCreate(message, context);
  });

  await client.login(token);

  return { client, db, queries };
}

if (require.main === module) {
  startBot().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  startBot,
};
