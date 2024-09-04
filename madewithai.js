const { Client, GatewayIntentBits, MessageEmbed } = require('discord.js');
const mysql = require('mysql');
const dotenv = require('dotenv');
const winston = require('winston');

// Load environment variables from a .env file for security
dotenv.config();

// Logger setup using Winston for better logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bot.log' }),
  ],
});

// Create a new Discord client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers, // Required to fetch all members in a guild
    GatewayIntentBits.MessageContent,
  ],
});

// Establish MySQL Database connection using environment variables
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Start the bot
client.on('ready', () => {
  logger.info(`Logged in as ${client.user.tag}`);
  startNotificationPolling();
});

// Polling function to regularly check the database for new notifications
function startNotificationPolling() {
  const pollingInterval = process.env.POLLING_INTERVAL || 5000; // Default to 5 seconds if not specified
  setInterval(checkForNewNotifications, pollingInterval); // Poll based on interval
}

// Function to check for new notifications
function checkForNewNotifications() {
  const sql = 'SELECT * FROM notifications WHERE sent = FALSE';

  db.query(sql, (err, results) => {
    if (err) {
      return logger.error(`Database query error: ${err.message}`);
    }

    results.forEach(processNotification);
  });
}

// Process a single notification based on its type
function processNotification(notification) {
  const { id, type, image_url, description, countdown_end, giveaway_end, guild_id, max_winners } = notification;

  switch (type) {
    case 'image':
      sendImageNotification(description, image_url, id);
      break;
    case 'countdown':
      scheduleCountdown(description, countdown_end, id);
      break;
    case 'giveaway':
      scheduleGiveaway(description, giveaway_end, id, guild_id, max_winners);
      break;
    case 'messageAll':
      messageAllUsersInServer(guild_id, description, id);
      break;
    case 'embed':
      sendRichEmbedNotification(guild_id, description, id);
      break;
    case 'uniqueTracker':
      trackUniqueKills(description, guild_id);
      break;
    default:
      logger.warn(`Unknown notification type: ${type}`);
  }
}

// Send an image notification to the Discord channel
function sendImageNotification(description, imageUrl, id) {
  fetchChannel(process.env.DISCORD_CHANNEL_ID).then((channel) => {
    channel
      .send({ content: description, files: [imageUrl] })
      .then(() => markAsSent(id))
      .catch((err) => logger.error(`Error sending image notification: ${err.message}`));
  });
}

// Send a rich embed notification to the Discord channel
function sendRichEmbedNotification(guildId, description, notificationId) {
  fetchChannel(process.env.DISCORD_CHANNEL_ID).then((channel) => {
    const embed = new MessageEmbed()
      .setTitle('Important Announcement')
      .setDescription(description)
      .setColor('#0099ff')
      .setTimestamp();

    channel
      .send({ embeds: [embed] })
      .then(() => markAsSent(notificationId))
      .catch((err) => logger.error(`Error sending embed notification: ${err.message}`));
  });
}

// Schedule a countdown notification
function scheduleCountdown(description, countdownEnd, id) {
  const now = new Date();
  const timeLeft = new Date(countdownEnd) - now;

  if (timeLeft > 0) {
    setTimeout(() => {
      fetchChannel(process.env.DISCORD_CHANNEL_ID).then((channel) => {
        channel
          .send(`${description} - Countdown has ended!`)
          .then(() => markAsSent(id))
          .catch((err) => logger.error(`Error sending countdown notification: ${err.message}`));
      });
    }, timeLeft);
  } else {
    markAsSent(id);
  }
}

// Schedule a giveaway notification and pick random winners
async function scheduleGiveaway(description, giveawayEnd, id, guildId, maxWinners) {
  const now = new Date();
  const timeLeft = new Date(giveawayEnd) - now;

  if (timeLeft > 0) {
    setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(guildId); // Fetch the guild by ID
        const members = await guild.members.fetch(); // Fetch all members in the guild
        const eligibleMembers = members.filter(member => !member.user.bot); // Exclude bots
        
        const winners = [];
        for (let i = 0; i < Math.min(maxWinners || 1, eligibleMembers.size); i++) {
          const winner = eligibleMembers.random();
          winners.push(winner);
          eligibleMembers.delete(winner.id); // Remove winner to avoid duplicate
        }

        const winnerNames = winners.map(winner => winner.user.username).join(', ');
        const winnerMessage = `${description} - Giveaway has ended! Winner${winners.length > 1 ? 's' : ''}: ${winnerNames}`;

        fetchChannel(process.env.DISCORD_CHANNEL_ID).then((channel) => {
          channel.send(winnerMessage).then(() => markAsSent(id)).catch((err) => logger.error(`Error sending giveaway notification: ${err.message}`));
        });

      } catch (error) {
        logger.error(`Error during giveaway: ${error.message}`);
      }
    }, timeLeft);
  } else {
    markAsSent(id);
  }
}

// Function to message all users in a specific server
async function messageAllUsersInServer(guildId, message, notificationId) {
  try {
    const guild = await client.guilds.fetch(guildId); // Fetch the guild by ID
    const members = await guild.members.fetch(); // Fetch all members in the guild

    // Send the message to each member
    members.forEach((member) => {
      if (!member.user.bot) { // Avoid messaging bots
        member.send(message).catch((err) => logger.error(`Could not send DM to ${member.user.tag}: ${err.message}`));
      }
    });

    markAsSent(notificationId);
  } catch (error) {
    logger.error(`Error messaging all users in server: ${error.message}`);
  }
}

// Track unique kills in the VSRO server
function trackUniqueKills(description, guildId) {
  // Example logic for tracking unique kills
  // This is just a placeholder; actual implementation will depend on the specifics of your VSRO setup
  logger.info(`Tracking unique kills for guild ${guildId}: ${description}`);
  // You can implement the logic to track kills and send updates to the Discord channel
}

// Mark a notification as sent in the database
function markAsSent(id) {
  const updateSql = 'UPDATE notifications SET sent = TRUE WHERE id = ?';

  db.query(updateSql, [id], (err) => {
    if (err) {
      logger.error(`Error updating notification status: ${err.message}`);
    }
  });
}

// Fetch a Discord channel by ID
async function fetchChannel(channelId) {
  try {
    return await client.channels.fetch(channelId);
  } catch (error) {
    logger.error(`Error fetching channel: ${error.message}`);
  }
}

// Handle unexpected errors
process.on('unhandledRejection', (error) => {
  logger.error(`Unhandled promise rejection: ${error.message}`);
});

// Login to Discord using the bot token from environment variables
client.login(process.env.DISCORD_BOT_TOKEN);
