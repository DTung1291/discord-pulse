require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
} = require("discord.js");

const { initDatabase } = require("../db/schema");
const { createQueries } = require("../db/queries");
const { onGuildMemberAdd } = require("./events/guildMemberAdd");
const { onGuildMemberRemove } = require("./events/guildMemberRemove");
const { onMessageCreate } = require("./events/messageCreate");
const { onInteractionCreate } = require("./events/interactionCreate");

function parseCsvIds(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("pulse-summary")
      .setDescription("Get activity summary for the last N days")
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("Number of days to include (1-30)")
          .setMinValue(1)
          .setMaxValue(30)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("pulse-daily")
      .setDescription("Get daily activity summary")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("pulse-weekly")
      .setDescription("Get weekly report with leaderboards")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("pulse-ghosts")
      .setDescription("List members with no recent activity")
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("Inactivity window in days (1-90)")
          .setMinValue(1)
          .setMaxValue(90)
      )
      .toJSON(),
  ];
}

async function registerGuildSlashCommands(client, guildId) {
  const commands = getSlashCommands();

  if (guildId) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.warn("Could not fetch configured guild for command registration.");
      return;
    }

    await guild.commands.set(commands);
    console.log(`Registered ${commands.length} slash commands for guild ${guild.id}`);
    return;
  }

  const guilds = await client.guilds.fetch();
  for (const [id] of guilds) {
    const guild = await client.guilds.fetch(id).catch(() => null);
    if (!guild) {
      continue;
    }
    await guild.commands.set(commands);
  }
  console.log(`Registered ${commands.length} slash commands for all connected guilds`);
}

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
    adminRoleIds: parseCsvIds(process.env.ADMIN_ROLE_IDS),
  };

  client.once("ready", async () => {
    console.log(`Bot logged in as ${client.user.tag}`);

    const guild = guildId
      ? await client.guilds.fetch(guildId).catch(() => null)
      : client.guilds.cache.first();

    if (guild) {
      await buildInviteCache(guild, invitesCache, queries);
    }

    await registerGuildSlashCommands(client, guildId).catch((error) => {
      console.warn("Slash command registration failed:", error.message);
    });
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

  client.on("interactionCreate", async (interaction) => {
    try {
      await onInteractionCreate(interaction, context);
    } catch (error) {
      console.error("Interaction handler error:", error);
      if (!interaction.isRepliable()) {
        return;
      }

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "Something went wrong while processing this command.",
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: "Something went wrong while processing this command.",
        ephemeral: true,
      });
    }
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
