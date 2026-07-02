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

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getAmbassadorMembers(guild, ambassadorRoleIds) {
  const roles = ambassadorRoleIds.length
    ? ambassadorRoleIds
        .map((id) => guild.roles.cache.get(id))
        .filter(Boolean)
    : [...guild.roles.cache.values()].filter((role) => /ambassador/i.test(role.name));

  const memberMap = new Map();
  for (const role of roles) {
    for (const member of role.members.values()) {
      if (!member.user.bot) {
        memberMap.set(member.id, member);
      }
    }
  }

  return [...memberMap.values()];
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
    new SlashCommandBuilder()
      .setName("pulse-ambassadors")
      .setDescription("Show ambassador invite performance leaderboard")
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("Number of days to include (1-90)")
          .setMinValue(1)
          .setMaxValue(90)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("pulse-ambassador-users")
      .setDescription("Show users invited by an ambassador and their ghost/active status")
      .addUserOption((option) =>
        option
          .setName("member")
          .setDescription("Ambassador member to inspect (default: you)")
      )
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("Number of days to include (1-90)")
          .setMinValue(1)
          .setMaxValue(90)
      )
      .addIntegerOption((option) =>
        option
          .setName("limit")
          .setDescription("Maximum users to list (1-30)")
          .setMinValue(1)
          .setMaxValue(30)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("pulse-leavers")
      .setDescription("List members who left recently with profile signals")
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("Number of days to include (1-90)")
          .setMinValue(1)
          .setMaxValue(90)
      )
      .addIntegerOption((option) =>
        option
          .setName("limit")
          .setDescription("Maximum members to list (1-30)")
          .setMinValue(1)
          .setMaxValue(30)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("pulse-leaves-daily")
      .setDescription("Show leave counts by day")
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("Number of days to include (1-90)")
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

async function buildVanityCache(guild, vanityCache) {
  try {
    const vanity = await guild.fetchVanityData();
    vanityCache.set(guild.id, Number(vanity?.uses || 0));
  } catch (_error) {
    // Guild may not have vanity URL or bot may not be allowed to fetch vanity data.
  }
}

async function syncGuildMembers(guild, queries) {
  try {
    const members = await guild.members.fetch();
    const snapshot = [];

    for (const member of members.values()) {
      snapshot.push({
        userId: member.id,
        username: member.user.tag,
        avatarUrl: member.user.avatarURL() || null,
        joinedAt: member.joinedAt ? member.joinedAt.toISOString() : new Date().toISOString(),
        isBot: member.user.bot,
      });
    }

    const result = queries.reconcileGuildMembers(snapshot);
    console.log(
      `Synced ${result.synced} active members from guild ${guild.id} (joins +${result.joinsAdded}, leaves +${result.leavesAdded})`
    );
  } catch (error) {
    console.warn("Member sync init failed:", error.message);
  }
}

async function syncGuildChannels(guild, queries) {
  try {
    const channels = await guild.channels.fetch();
    const rows = [];

    for (const channel of channels.values()) {
      if (!channel || !channel.id || !channel.name) {
        continue;
      }

      rows.push({
        channelId: channel.id,
        channelName: channel.name,
      });
    }

    queries.syncChannels(rows);
    console.log(`Synced ${rows.length} channels metadata from guild ${guild.id}`);
  } catch (error) {
    console.warn("Channel metadata sync failed:", error.message);
  }
}

async function provisionAmbassadorInvites(guild, queries, ambassadorRoleIds, inviteChannelId) {
  if (!inviteChannelId) {
    return;
  }

  try {
    const channel = await guild.channels.fetch(inviteChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.warn("Ambassador invite provisioning skipped: invite channel not found or not text-based.");
      return;
    }

    const ambassadors = getAmbassadorMembers(guild, ambassadorRoleIds);
    if (!ambassadors.length) {
      console.warn("Ambassador invite provisioning skipped: no ambassador members found.");
      return;
    }

    const existing = queries.listAmbassadorInvites();
    const invites = await guild.invites.fetch();
    const byAmbassadorId = new Map(existing.map((row) => [row.ambassador_id, row]));

    let created = 0;
    for (const member of ambassadors) {
      const prev = byAmbassadorId.get(member.id);
      if (prev && invites.has(prev.code)) {
        continue;
      }

      const invite = await channel.createInvite({
        maxAge: 0,
        maxUses: 0,
        unique: true,
        reason: `Ambassador tracking invite for ${member.user.tag}`,
      });

      queries.upsertAmbassadorInvite({
        code: invite.code,
        ambassadorId: member.id,
        ambassadorName: member.user.username,
        channelId: channel.id,
        createdAt: new Date().toISOString(),
      });

      created += 1;
    }

    console.log(`Ambassador invites ready: ${ambassadors.length} ambassadors (${created} newly created)`);
  } catch (error) {
    console.warn("Ambassador invite provisioning failed:", error.message);
  }
}

async function backfillAmbassadorPosts(guild, queries, channelId, maxMessages) {
  if (!channelId || maxMessages <= 0) {
    return;
  }

  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.warn("Ambassador post backfill skipped: channel not found or not text-based.");
      return;
    }

    const ambassadorRows = queries.listAmbassadorInvites();
    const ambassadorById = new Map(ambassadorRows.map((row) => [row.ambassador_id, row.ambassador_name]));
    if (!ambassadorById.size) {
      console.warn("Ambassador post backfill skipped: no ambassador mapping found.");
      return;
    }

    let scanned = 0;
    let saved = 0;
    let before;

    while (scanned < maxMessages) {
      const batchLimit = Math.min(100, maxMessages - scanned);
      const batch = await channel.messages.fetch({
        limit: batchLimit,
        ...(before ? { before } : {}),
      });

      if (!batch.size) {
        break;
      }

      for (const message of batch.values()) {
        scanned += 1;

        if (message.author.bot) {
          continue;
        }

        const ambassadorName = ambassadorById.get(message.author.id);
        if (!ambassadorName) {
          continue;
        }

        queries.trackAmbassadorPost({
          messageId: message.id,
          ambassadorId: message.author.id,
          ambassadorName,
          channelId: message.channel.id,
          content: message.content || "",
          postedAt: message.createdAt.toISOString(),
        });
        saved += 1;
      }

      before = batch.last().id;
      if (batch.size < batchLimit) {
        break;
      }
    }

    console.log(
      `Ambassador post backfill done for channel ${channelId}: scanned ${scanned}, stored ${saved}`
    );
  } catch (error) {
    console.warn("Ambassador post backfill failed:", error.message);
  }
}

async function startBot(options = {}) {
  const token = options.token || process.env.DISCORD_TOKEN;
  const guildId = options.guildId || process.env.GUILD_ID;

  const db = options.db || initDatabase(process.env.DB_PATH);
  const queries = options.queries || createQueries(db);
  const invitesCache = new Map();
  const vanityCache = new Map();

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
    vanityCache,
    adminRoleIds: parseCsvIds(process.env.ADMIN_ROLE_IDS),
    ambassadorPostChannelId: process.env.AMBASSADOR_POST_CHANNEL_ID || "1518242290982719698",
  };

  const ambassadorRoleIds = parseCsvIds(process.env.AMBASSADOR_ROLE_IDS);
  const ambassadorInviteChannelId = process.env.AMBASSADOR_INVITE_CHANNEL_ID;
  const ambassadorPostBackfillLimit = toPositiveInt(process.env.AMBASSADOR_POST_BACKFILL_LIMIT, 2000);

  client.once("clientReady", async () => {
    console.log(`Bot logged in as ${client.user.tag}`);

    const guild = guildId
      ? await client.guilds.fetch(guildId).catch(() => null)
      : client.guilds.cache.first();

    if (guild) {
      await syncGuildMembers(guild, queries);
      await syncGuildChannels(guild, queries);
      await buildVanityCache(guild, vanityCache);
      await buildInviteCache(guild, invitesCache, queries);
      await provisionAmbassadorInvites(
        guild,
        queries,
        ambassadorRoleIds,
        ambassadorInviteChannelId
      );
      await backfillAmbassadorPosts(
        guild,
        queries,
        context.ambassadorPostChannelId,
        ambassadorPostBackfillLimit
      );
    }

    await registerGuildSlashCommands(client, guildId).catch((error) => {
      console.warn("Slash command registration failed:", error.message);
    });
  });

  client.on("guildMemberAdd", async (member) => {
    await onGuildMemberAdd(member, context);
  });

  client.on("inviteCreate", async (invite) => {
    if (!invite?.guild) {
      return;
    }

    await buildInviteCache(invite.guild, invitesCache, queries);
  });

  client.on("inviteDelete", async (invite) => {
    if (!invite?.guild) {
      return;
    }

    await buildInviteCache(invite.guild, invitesCache, queries);
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

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "Something went wrong while processing this command.",
            flags: 64,
          });
          return;
        }

        await interaction.reply({
          content: "Something went wrong while processing this command.",
          flags: 64,
        });
      } catch (replyError) {
        if (replyError && Number(replyError.code) === 40060) {
          // Interaction was already acknowledged elsewhere; avoid crashing the bot.
          return;
        }

        console.error("Failed to send interaction error response:", replyError);
      }
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
