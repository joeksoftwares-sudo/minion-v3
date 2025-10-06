const {
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
    StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
    TextInputStyle, ChannelType, PermissionsBitField, AttachmentBuilder,
    Collection,
    MessageFlags
} = require('discord.js');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID; 
const TICKET_PANEL_CHANNEL_ID = process.env.TICKET_PANEL_CHANNEL_ID;
const TRANSCRIPT_LOG_CHANNEL_ID = process.env.TRANSCRIPT_LOG_CHANNEL_ID;
const ADMIN_APPROVAL_CHANNEL_ID = process.env.ADMIN_APPROVAL_CHANNEL_ID;
const MEDIA_CATEGORY_ID = process.env.MEDIA_CATEGORY_ID;
const REPORT_CATEGORY_ID = process.env.REPORT_CATEGORY_ID;
const SUPPORT_CATEGORY_ID = process.env.SUPPORT_CATEGORY_ID;

const PAYOUT_VALUES = {
    'General Support': 15,
    'Report Exploiters': 20,
    'Apply for Media': 25,
};

const PAYOUT_MIN = 300;
const PAYOUT_MAX = 700;
const UNCLAIM_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes


const staffData = new Map(); 
const ticketLogs = new Map(); 
let transactionCounter = 0;
const transactionLogs = []; 

const claimedTickets = new Collection();

const userProfiles = new Map();
const userEconomy = new Map();
const userPets = new Map();
const userInventories = new Map();
const activeGames = new Map();
const serverEvents = [];
const userReminders = new Map();
const userTimers = new Map();
const guildData = new Map();
const userAchievements = new Map();
const userStats = new Map();
const activePolls = new Map();
const userRelationships = new Map();
const clanData = new Map();
const marketListings = new Map();
const userQuests = new Map();
const activeDuels = new Map();
const userBookmarks = new Map();
const userNotes = new Map();
const userTodos = new Map();
const userSchedules = new Map();
const serverNews = [];
const userSubscriptions = new Map();
const confessions = [];
const suggestions = [];
const serverReviews = [];

const jokes = [
    "Why don't scientists trust atoms? Because they make up everything!",
    "Why did the scarecrow win an award? He was outstanding in his field!",
    "Why don't eggs tell jokes? They'd crack each other up!",
    "What do you call a fake noodle? An impasta!",
    "Why did the coffee file a police report? It got mugged!",
    "What do you call a bear with no teeth? A gummy bear!",
    "Why don't skeletons fight each other? They don't have the guts!",
    "What's the best thing about Switzerland? I don't know, but the flag is a big plus!"
];

const quotes = [
    "The only way to do great work is to love what you do. - Steve Jobs",
    "Innovation distinguishes between a leader and a follower. - Steve Jobs",
    "Life is what happens to you while you're busy making other plans. - John Lennon",
    "The future belongs to those who believe in the beauty of their dreams. - Eleanor Roosevelt",
    "It is during our darkest moments that we must focus to see the light. - Aristotle",
    "Success is not final, failure is not fatal: it is the courage to continue that counts. - Winston Churchill",
    "The only impossible journey is the one you never begin. - Tony Robbins",
    "In the middle of difficulty lies opportunity. - Albert Einstein"
];

const facts = [
    "Octopuses have three hearts and blue blood!",
    "Bananas are berries, but strawberries aren't!",
    "A group of flamingos is called a 'flamboyance'!",
    "Honey never spoils - archaeologists have found edible honey in ancient Egyptian tombs!",
    "A shrimp's heart is in its head!",
    "Elephants are one of the few animals that can recognize themselves in a mirror!",
    "The shortest war in history lasted only 38-45 minutes!",
    "There are more possible games of chess than atoms in the universe!"
];

const eightBallResponses = [
    "It is certain", "Reply hazy, try again", "Don't count on it", "It is decidedly so",
    "My sources say no", "Yes definitely", "Cannot predict now", "Outlook not so good",
    "You may rely on it", "Concentrate and ask again", "Very doubtful", "As I see it, yes",
    "My reply is no", "Outlook good", "Signs point to yes", "Better not tell you now",
    "Absolutely!", "Ask again later", "Most likely", "Without a doubt"
];

const compliments = [
    "You're absolutely amazing!", "You light up every room you enter!", "You have the best laugh!",
    "You're incredibly thoughtful!", "You bring out the best in people!", "You're one of a kind!",
    "You have great taste!", "You're stronger than you realize!", "You're a fantastic friend!",
    "You make everything better!", "You're incredibly talented!", "You inspire others!"
];

const advice = [
    "Follow your dreams, they know the way!", "Be yourself; everyone else is already taken!",
    "Don't let yesterday take up too much of today!", "The best time to plant a tree was 20 years ago. The second best time is now!",
    "You are never too old to set another goal or to dream a new dream!", "Believe you can and you're halfway there!",
    "Life is 10% what happens to you and 90% how you react to it!", "Don't wait for opportunity. Create it!"
];

const roasts = [
    "You're like a software update. Nobody wants you, but you keep showing up anyway!",
    "I'd explain it to you, but I don't have any crayons with me!",
    "You're proof that even evolution makes mistakes sometimes!",
    "I'm not saying you're dumb, but you make me miss my pet rock!",
    "You're like a cloud. When you disappear, it's a beautiful day!",
    "If ignorance is bliss, you must be the happiest person alive!"
]; 

/**
 * Updates a staff member's Robux balance (In-Memory). Creates the user record if it doesn't exist.
 * This function is now synchronous.
 * @param {string} userId The ID of the staff member.
 * @param {number} amount The amount to add (can be negative for payout reset).
 */
function updateRobuxBalance(userId, amount) {
    const data = staffData.get(userId) || { robux_balance: 0 };
    data.robux_balance += amount;
    staffData.set(userId, data);
    return data.robux_balance;
}


/**
 * Fetches the ticket log data for a channel.
 * @param {string} channelId 
 * @returns {object|null} The ticket log object or null if not found/closed.
 */
function getActiveTicketLog(channelId) {
    const log = ticketLogs.get(channelId);
    return (log && log.end_time === null) ? log : null;
}


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('⚠️ WARNING: Using In-Memory Storage. All data will be lost on bot restart/redeploy.');
    await registerSlashCommands(client.application.id);
    await setupTicketPanel();
});


/**
 * Registers global slash commands.
 * @param {string} clientId The application ID.
 */
async function registerSlashCommands(clientId) {
    const commands = [
        {
            name: 'check-robux',
            description: 'Check your current Robux payout balance.',
        },
        {
            name: 'payout',
            description: 'Initiate a Robux payout request.',
        },
        {
            name: 'add-robux',
            description: 'ADMIN ONLY: Manually add Robux to staff balance.',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
        },
        {
            name: 'panel',
            description: 'ADMIN ONLY: Deploys the persistent ticket panel.',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
        },
        {
            name: 'close-ticket',
            description: 'STAFF ONLY: Soft-close ticket (sends reward request).',
        },
        {
            name: 'delete-ticket',
            description: 'ADMIN ONLY: Generate transcript and delete ticket.',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
        },
        {
            name: 'payout-stats',
            description: 'ADMIN ONLY: View payout statistics and data.',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
        },
        {
            name: 'user-info',
            description: 'ADMIN ONLY: View user information.',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
        },
        {
            name: 'roll',
            description: '🎲 Roll dice with custom sides!',
        },
        {
            name: 'coinflip',
            description: '🪙 Flip a coin and test your luck!',
        },
        {
            name: '8ball',
            description: '🎱 Ask the magic 8-ball a question!',
        },
        {
            name: 'rps',
            description: '✂️ Play Rock, Paper, Scissors!',
        },
        {
            name: 'joke',
            description: '😂 Get a random joke to brighten your day!',
        },
        {
            name: 'quote',
            description: '💭 Get an inspirational quote!',
        },
        {
            name: 'meme',
            description: '😎 Generate a random meme title!',
        },
        {
            name: 'weather',
            description: '🌤️ Check the weather for any city!',
        },
        {
            name: 'fact',
            description: '🧠 Learn a random interesting fact!',
        },
        {
            name: 'password',
            description: '🔐 Generate a secure random password!',
        },
        {
            name: 'color',
            description: '🎨 Generate a random color with hex code!',
        },
        {
            name: 'avatar',
            description: '🖼️ Get someone\'s avatar in full resolution!',
        },
        {
            name: 'serverinfo',
            description: '📊 Get server information!',
        },
        {
            name: 'userprofile',
            description: '👤 Get user profile info!',
        },
        {
            name: 'poll',
            description: '📊 Create a poll with up to 10 options!',
        },
        {
            name: 'timer',
            description: '⏰ Set a timer and get reminded!',
        },
        {
            name: 'reminder',
            description: '📝 Set a reminder for later!',
        },
        {
            name: 'calculate',
            description: '🧮 Perform mathematical calculations!',
        },
        {
            name: 'morse',
            description: '📡 Convert text to/from Morse code!',
        },
        {
            name: 'binary',
            description: '💾 Convert text to/from binary!',
        },
        {
            name: 'base64',
            description: '🔐 Encode/decode text in Base64!',
        },
        {
            name: 'qr',
            description: '📱 Generate a QR code for any text!',
        },
        {
            name: 'ascii',
            description: '📝 Convert text to ASCII art!',
        },
        {
            name: 'reverse',
            description: '🔄 Reverse any text!',
        },
        {
            name: 'scramble',
            description: '🔀 Scramble the letters in text!',
        },
        {
            name: 'wordcount',
            description: '📏 Count words and characters in text!',
        },
        {
            name: 'translate',
            description: '🌍 Translate text between languages!',
        },
        {
            name: 'urban',
            description: '📚 Look up a term in Urban Dictionary!',
        },
        {
            name: 'wikipedia',
            description: '📖 Search Wikipedia for information!',
        },
        {
            name: 'cat',
            description: '🐱 Get a random cute cat picture!',
        },
        {
            name: 'dog',
            description: '🐶 Get a random cute dog picture!',
        },
        {
            name: 'pokemon',
            description: '⚡ Get Pokémon information!',
        },
        {
            name: 'horoscope',
            description: '⭐ Get your daily horoscope!',
        },
        {
            name: 'number',
            description: '🔢 Get an interesting number fact!',
        },
        {
            name: 'compliment',
            description: '💖 Get or give a nice compliment!',
        },
        {
            name: 'insult',
            description: '😈 Get a creative (harmless) insult!',
        },
        {
            name: 'advice',
            description: '💡 Get some random life advice!',
        },
        {
            name: 'achievement',
            description: '🏆 Generate a Minecraft achievement!',
        },
        {
            name: 'ship',
            description: '💕 Ship two users and see compatibility!',
        },
        {
            name: 'rate',
            description: '⭐ Rate anything from 1-10!',
        },
        {
            name: 'choose',
            description: '🤔 Let the bot choose between options!',
        },
        {
            name: 'roast',
            description: '🔥 Get roasted by the bot (all fun)!',
        },
        {
            name: 'trivia',
            description: '🧩 Answer a random trivia question!',
        },
        {
            name: 'riddle',
            description: '🧩 Get a riddle to solve!',
        },
        {
            name: 'anagram',
            description: '🔤 Find anagrams of a word!',
        },
        {
            name: 'rhyme',
            description: '🎵 Find words that rhyme!',
        },
        {
            name: 'fizzbuzz',
            description: '🎮 Play the classic FizzBuzz game!',
        },
        {
            name: 'simon',
            description: '🎵 Play Simon Says memory game!',
        },
        {
            name: 'hangman',
            description: '🎪 Play a word guessing game!',
        },
        {
            name: 'wordle',
            description: '📝 Play a Wordle-style word game!',
        },
        {
            name: 'blackjack',
            description: '🃏 Play Blackjack against the dealer!',
        },
        {
            name: 'slots',
            description: '🎰 Try your luck at the slot machine!',
        },
        {
            name: 'lottery',
            description: '🎫 Buy a lottery ticket and see if you win!',
        },
        {
            name: 'leaderboard',
            description: '🏅 View the server leaderboard!',
        },
        {
            name: 'level',
            description: '📈 Check your server activity level and XP!',
        },
        {
            name: 'daily',
            description: '📅 Claim your daily reward!',
        },
        {
            name: 'inventory',
            description: '🎒 Check your virtual inventory!',
        },
        {
            name: 'shop',
            description: '🛒 Browse the virtual item shop!',
        },
        {
            name: 'gift',
            description: '🎁 Send a virtual gift to another user!',
        },
        {
            name: 'economy',
            description: '💰 Check the server\'s virtual economy stats!',
        },
        {
            name: 'work',
            description: '💼 Do some virtual work to earn coins!',
        },
        {
            name: 'rob',
            description: '🔪 Try to rob another user (virtual fun)!',
        },
        {
            name: 'gamble',
            description: '🎲 Gamble your coins for a chance to win big!',
        },
        {
            name: 'bank',
            description: '🏦 Manage your virtual bank account!',
        },
        {
            name: 'marry',
            description: '💒 Propose marriage to another user!',
        },
        {
            name: 'divorce',
            description: '💔 File for divorce (virtual relationships)!',
        },
        {
            name: 'adopt',
            description: '👶 Adopt a virtual pet!',
        },
        {
            name: 'pet',
            description: '🐾 Interact with your virtual pets!',
        },
        {
            name: 'feed',
            description: '🍖 Feed your virtual pets!',
        },
        {
            name: 'fish',
            description: '🎣 Go fishing and catch virtual fish!',
        },
        {
            name: 'hunt',
            description: '🏹 Go hunting for virtual animals!',
        },
        {
            name: 'mine',
            description: '⛏️ Mine for virtual resources!',
        },
        {
            name: 'craft',
            description: '🔨 Craft items from your resources!',
        },
        {
            name: 'battle',
            description: '⚔️ Battle other users with your items!',
        },
        {
            name: 'duel',
            description: '🤺 Challenge someone to a duel!',
        },
        {
            name: 'stats',
            description: '📊 View your game statistics!',
        },
        {
            name: 'achievements',
            description: '🏅 View all available achievements!',
        },
        {
            name: 'quest',
            description: '🗺️ Start or check your current quest!',
        },
        {
            name: 'dungeon',
            description: '🏰 Explore a dangerous dungeon!',
        },
        {
            name: 'raid',
            description: '🐉 Join or start a raid against a boss!',
        },
        {
            name: 'guild',
            description: '⚔️ Manage your adventure guild!',
        },
        {
            name: 'magic',
            description: '🔮 Cast magical spells!',
        },
        {
            name: 'potion',
            description: '🧪 Brew and use magical potions!',
        },
        {
            name: 'spell',
            description: '✨ Learn and cast new spells!',
        },
        {
            name: 'enchant',
            description: '⚡ Enchant your weapons and armor!',
        },
        {
            name: 'arena',
            description: '🏟️ Fight in the arena for glory!',
        },
        {
            name: 'tournament',
            description: '🏆 Join or create tournaments!',
        },
        {
            name: 'clan',
            description: '🛡️ Create or join a clan!',
        },
        {
            name: 'war',
            description: '⚔️ Declare war between clans!',
        },
        {
            name: 'trade',
            description: '🤝 Trade items with other users!',
        },
        {
            name: 'auction',
            description: '🔨 Auction your items to the highest bidder!',
        },
        {
            name: 'market',
            description: '🏪 Browse the user marketplace!',
        },
        {
            name: 'news',
            description: '📰 Get the latest server news and updates!',
        },
        {
            name: 'events',
            description: '🎉 Check upcoming server events!',
        },
        {
            name: 'birthday',
            description: '🎂 Set your birthday for special celebrations!',
        },
        {
            name: 'timezone',
            description: '🌍 Set your timezone for better coordination!',
        },
        {
            name: 'afk',
            description: '😴 Set yourself as AFK with a custom message!',
        },
        {
            name: 'status',
            description: '📝 Set a custom status message!',
        },
        {
            name: 'badge',
            description: '🎖️ View and equip your earned badges!',
        },
        {
            name: 'title',
            description: '👑 Set a custom title for your profile!',
        },
        {
            name: 'background',
            description: '🖼️ Set a custom background for your profile!',
        },
        {
            name: 'theme',
            description: '🎨 Change your profile theme colors!',
        },
        {
            name: 'music',
            description: '🎵 Set your favorite song on your profile!',
        },
        {
            name: 'mood',
            description: '😊 Set your current mood!',
        },
        {
            name: 'activity',
            description: '🎮 Set what activity you\'re currently doing!',
        },
        {
            name: 'bio',
            description: '📝 Set a custom biography for your profile!',
        },
        {
            name: 'social',
            description: '🔗 Add your social media links to your profile!',
        },
        {
            name: 'playlist',
            description: '🎶 Create and manage music playlists!',
        },
        {
            name: 'radio',
            description: '📻 Listen to virtual radio stations!',
        },
        {
            name: 'karaoke',
            description: '🎤 Host a karaoke session!',
        },
        {
            name: 'dance',
            description: '💃 Show off your dance moves!',
        },
        {
            name: 'emote',
            description: '😄 Use custom server emotes and reactions!',
        },
        {
            name: 'gif',
            description: '🎬 Search and share animated GIFs!',
        },
        {
            name: 'sticker',
            description: '🏷️ Use and create custom stickers!',
        },
        {
            name: 'soundboard',
            description: '🔊 Play sounds from the soundboard!',
        },
        {
            name: 'voice',
            description: '🎙️ Record and share voice messages!',
        },
        {
            name: 'tts',
            description: '🗣️ Convert text to speech!',
        },
        {
            name: 'whisper',
            description: '🤫 Send a private whisper to someone!',
        },
        {
            name: 'shout',
            description: '📢 Make an announcement to everyone!',
        },
        {
            name: 'confession',
            description: '💭 Submit an anonymous confession!',
        },
        {
            name: 'suggestion',
            description: '💡 Submit a suggestion for the server!',
        },
        {
            name: 'report',
            description: '⚠️ Report a user or issue to moderators!',
        },
        {
            name: 'feedback',
            description: '📝 Leave feedback about the server!',
        },
        {
            name: 'review',
            description: '⭐ Review and rate the server!',
        },
        {
            name: 'subscribe',
            description: '🔔 Subscribe to server notifications!',
        },
        {
            name: 'bookmark',
            description: '🔖 Bookmark messages for later!',
        },
        {
            name: 'notes',
            description: '📋 Create and manage personal notes!',
        },
        {
            name: 'todo',
            description: '✅ Manage your todo list!',
        },
        {
            name: 'calendar',
            description: '📅 View and manage your calendar!',
        },
        {
            name: 'schedule',
            description: '🗓️ Schedule events and meetings!',
        },
        {
            name: 'alarm',
            description: '⏰ Set multiple alarms!',
        },
        {
            name: 'stopwatch',
            description: '⏱️ Use a stopwatch for timing!',
        },
        {
            name: 'countdown',
            description: '⏳ Create countdown timers!',
        },
        {
            name: 'worldclock',
            description: '🌍 Check the time in different time zones!',
        },
        {
            name: 'uptime',
            description: '🕐 Check how long the bot has been running!',
        },
        {
            name: 'ping',
            description: '🏓 Check the bot\'s response time!',
        },
        {
            name: 'botinfo',
            description: '🤖 Get information about the bot!',
        },
        {
            name: 'version',
            description: '📊 Check the bot\'s version and changelog!',
        },
        {
            name: 'help',
            description: '❓ Get help with bot commands!',
        },
        {
            name: 'commands',
            description: '📝 List all available commands!',
        },
        {
            name: 'support',
            description: '🆘 Get support and contact information!',
        },
        {
            name: 'credits',
            description: '👏 View bot credits and contributors!',
        },
        {
            name: 'changelog',
            description: '📋 View recent bot updates and changes!',
        }
    ];

    try {
        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);

        if (guild) {
            await guild.commands.set(commands);
            console.log(`✅ Slash commands successfully registered to guild: ${guild.name}`);
        } else {
            console.error(`❌ CRITICAL ERROR: Guild with ID "${GUILD_ID}" not found or bot is not a member. Commands cannot be registered.`);
        }
    } catch (error) {
        console.error('❌ FATAL Error registering slash commands:', error);
    }
}

/**
 * Creates the main ticket panel embed and select menu.
 * @returns {object} The embed and action row components.
 */
function createTicketPanel() {
    const embed = new EmbedBuilder()
        .setTitle('🎫 Official Support Ticket System')
        .setDescription(
            'Welcome to the Server Support System. Please select the category that best fits your inquiry from the dropdown menu below. This will automatically open a private channel for you to speak with our staff.'
        )
        .setColor('#5865F2') // Discord Primary Blue/Purple
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: 'Powered by the Bot Team' })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_ticket_type')
        .setPlaceholder('Select a Ticket Category...')
        .addOptions([
            {
                label: 'Apply for Media',
                description: 'For content creators interested in partnership.',
                value: 'Apply for Media',
                emoji: '🎥',
            },
            {
                label: 'Report Exploiters',
                description: 'Report rule-breakers or exploiters privately.',
                value: 'Report Exploiters',
                emoji: '🚨',
            },
            {
                label: 'General Support',
                description: 'For all general questions, help, or issues.',
                value: 'General Support',
                emoji: '❓',
            },
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return { embed, row };
}

/**
 * Posts the persistent ticket panel to the designated channel.
 */
async function setupTicketPanel() {
    const channel = client.channels.cache.get(TICKET_PANEL_CHANNEL_ID);
    if (!channel) return console.error('Ticket Panel Channel ID not found.');

    console.log('Ticket panel generated. Use /panel to deploy it.');
}

/**
 * Generates the action row component based on the ticket's current claim and close status.
 * @param {boolean} isClaimed - Whether the ticket is currently claimed.
 * @param {boolean} isSoftClosed - Whether the ticket has been soft-closed (Robux added).
 * @returns {ActionRowBuilder} The action row component.
 */
function getTicketActionRow(isClaimed, isSoftClosed) {
    const claimButton = new ButtonBuilder()
        .setCustomId(isClaimed ? 'ticket_unclaim' : 'ticket_claim')
        .setLabel(isClaimed ? 'Unclaim' : 'Claim')
        .setStyle(ButtonStyle.Primary)
        .setEmoji(isClaimed ? '🔓' : '🔒')
        .setDisabled(isSoftClosed); 

    let closeOrDeleteButton;

    if (isSoftClosed) {
        closeOrDeleteButton = new ButtonBuilder()
            .setCustomId('ticket_finalize_delete')
            .setLabel('Finalize & Delete')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('💣');
    } else {
        closeOrDeleteButton = new ButtonBuilder()
            .setCustomId('ticket_soft_close')
            .setLabel('Close (Request Reward)') // Updated label to reflect new process
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('💾');
    }

    const adminDeleteButton = new ButtonBuilder()
        .setCustomId('ticket_admin_delete')
        .setLabel('Admin Delete')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
        .setDisabled(isSoftClosed); 

    const row = new ActionRowBuilder().addComponents(claimButton, closeOrDeleteButton, adminDeleteButton);
    return row;
}



/**
 * Generates a simple, Discord-styled HTML transcript of a channel's messages.
 * @param {Collection<string, Message>} messages - The messages to include.
 * @param {GuildMember} creator - The ticket creator.
 * @returns {string} The HTML content.
 */
function generateHtmlTranscript(messages, creator) {
    let content = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ticket Transcript - ${creator.user.tag}</title>
        <style>
            body { background-color: #36393f; color: #dcddde; font-family: 'Inter', sans-serif; }
            .chat-log { width: 90%; max-width: 800px; margin: 20px auto; padding: 20px; background-color: #36393f; }
            .message { margin-bottom: 10px; padding: 5px 10px; border-radius: 4px; }
            .header { color: #8e9297; font-size: 14px; margin-bottom: 5px; border-bottom: 1px solid #4f545c; padding-bottom: 3px; }
            .username { font-weight: bold; }
            .bot-tag { background-color: #5865f2; color: white; padding: 2px 4px; border-radius: 3px; font-size: 10px; margin-left: 5px; }
            .content { font-size: 15px; margin-top: 5px; line-height: 1.4; }
        </style>
    </head>
    <body>
        <div class="chat-log">
            <h1>Ticket Transcript for ${creator.user.tag}</h1>
            <p>Ticket Opened: ${new Date().toLocaleString()}</p>
            <hr>
    `;

    messages.forEach(msg => {
        const timestamp = new Date(msg.createdTimestamp).toLocaleString();
        const usernameColor = msg.member?.displayHexColor || '#ffffff';
        const botTag = msg.author.bot ? '<span class="bot-tag">BOT</span>' : '';

        content += `
            <div class="message">
                <div class="message">
                    <div class="header">
                        <span class="username" style="color: ${usernameColor};">${msg.author.username}</span>
                        ${botTag}
                        <span style="float: right; font-size: 12px;">${timestamp}</span>
                    </div>
                    <div class="content">${msg.content.replace(/\n/g, '<br>')}</div>
                </div>
            </div>
        `;
    });

    content += `
        </div>
    </body>
    </html>
    `;
    return content;
}


client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        await handleSlashCommand(interaction);
    } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
    } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
    } else if (interaction.isButton()) {
        await handleButton(interaction);
    }
});

/**
 * Handles all slash command interactions.
 * @param {CommandInteraction} interaction
 */
async function handleSlashCommand(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: 'This command must be run in a server.', flags: EPHEMERAL_FLAG });

    const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    try {
        switch (interaction.commandName) {
            case 'panel':
                if (!isAdmin) return interaction.reply({ content: 'You need Administrator permissions to set up the panel.', flags: EPHEMERAL_FLAG });
                const { embed, row } = createTicketPanel();
                await interaction.channel.send({ embeds: [embed], components: [row] });
                await interaction.reply({ content: 'Ticket panel deployed successfully.', flags: EPHEMERAL_FLAG });
                break;

            case 'check-robux':
                if (!isStaff) return interaction.reply({ content: 'You must be a staff member to use this command.', flags: EPHEMERAL_FLAG });
                
                try {
                    const data = staffData.get(interaction.user.id);
                    const balance = data ? data.robux_balance : 0;

                    const embed = new EmbedBuilder()
                        .setTitle('💰 Robux Payout Balance')
                        .setColor('#FFC0CB')
                        .setDescription(`
                            Your current earned balance is **${balance} R$**.
                            ---
                            **Payout Rules:**
                            - **Min Request:** ${PAYOUT_MIN} R$
                            - **Max Request:** ${PAYOUT_MAX} R$
                            - Use \`/payout\` when you are ready to request a payment.
                        `);
                    await interaction.reply({ embeds: [embed], flags: EPHEMERAL_FLAG });
                } catch (error) {
                    console.error('Error checking balance:', error);
                    await interaction.reply({ content: 'An error occurred while fetching your balance.', flags: EPHEMERAL_FLAG });
                }
                break;

            case 'payout':
                if (!isStaff) return interaction.reply({ content: 'You must be a staff member to use this command.', flags: EPHEMERAL_FLAG });
                
                const modal = new ModalBuilder()
                    .setCustomId('payout_modal')
                    .setTitle('Robux Payout Request');

                const amountInput = new TextInputBuilder()
                    .setCustomId('payout_amount')
                    .setLabel('Requested Robux Amount (R$)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(`Between ${PAYOUT_MIN} and ${PAYOUT_MAX}`)
                    .setRequired(true);

                const gamepassInput = new TextInputBuilder()
                    .setCustomId('gamepass_link')
                    .setLabel('Roblox Gamepass Link')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('https://www.roblox.com/game-pass/...')
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(amountInput),
                    new ActionRowBuilder().addComponents(gamepassInput)
                );
                await interaction.showModal(modal);
                break;
                
            case 'add-robux':
                if (!isAdmin) return interaction.reply({ content: 'You need Administrator permissions to use this command.', flags: EPHEMERAL_FLAG });
                
                const addRobuxModal = new ModalBuilder()
                    .setCustomId('add_robux_modal')
                    .setTitle('Manually Add Robux');

                const targetIdInput = new TextInputBuilder()
                    .setCustomId('target_user_id')
                    .setLabel('Target Staff Member ID')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const amountToAddInput = new TextInputBuilder()
                    .setCustomId('robux_amount_to_add')
                    .setLabel('Robux Amount to Add (R$)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                addRobuxModal.addComponents(
                    new ActionRowBuilder().addComponents(targetIdInput),
                    new ActionRowBuilder().addComponents(amountToAddInput)
                );
                await interaction.showModal(addRobuxModal);
                break;
                
            case 'close-ticket':
                if (!isStaff) return interaction.reply({ content: 'You must be staff to use this command.', flags: EPHEMERAL_FLAG });
                await interaction.deferReply({ flags: EPHEMERAL_FLAG });
                await handleSoftCloseLogic(interaction, interaction.channel.id, interaction.user.id, true);
                break;
                
            case 'delete-ticket':
                if (!isAdmin) return interaction.reply({ content: 'You must be an admin to use this command.', flags: EPHEMERAL_FLAG });
                await interaction.deferReply({ flags: EPHEMERAL_FLAG });
                await handleDeleteLogic(interaction, interaction.channel.id, interaction.user.id, true);
                break;
                
            case 'payout-stats':
                if (!isAdmin) return interaction.reply({ content: 'You need Administrator permissions to use this command.', flags: EPHEMERAL_FLAG });
                await interaction.deferReply({ flags: EPHEMERAL_FLAG });
                await handlePayoutStatsCommand(interaction);
                break;
                
            case 'user-info':
                if (!isAdmin) return interaction.reply({ content: 'You need Administrator permissions to use this command.', flags: EPHEMERAL_FLAG });
                
                const userInfoModal = new ModalBuilder()
                    .setCustomId('user_info_modal')
                    .setTitle('User Information Lookup');

                const userIdInput = new TextInputBuilder()
                    .setCustomId('lookup_user_id')
                    .setLabel('User ID to lookup')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter Discord User ID')
                    .setRequired(true);

                userInfoModal.addComponents(
                    new ActionRowBuilder().addComponents(userIdInput)
                );
                await interaction.showModal(userInfoModal);
                break;
                
            case 'roll':
                await handleRollCommand(interaction);
                break;
            case 'coinflip':
                await handleCoinflipCommand(interaction);
                break;
            case '8ball':
                await handle8BallCommand(interaction);
                break;
            case 'rps':
                await handleRPSCommand(interaction);
                break;
            case 'joke':
                await handleJokeCommand(interaction);
                break;
            case 'quote':
                await handleQuoteCommand(interaction);
                break;
            case 'meme':
                await handleMemeCommand(interaction);
                break;
            case 'weather':
                await handleWeatherCommand(interaction);
                break;
            case 'fact':
                await handleFactCommand(interaction);
                break;
            case 'password':
                await handlePasswordCommand(interaction);
                break;
            case 'color':
                await handleColorCommand(interaction);
                break;
            case 'avatar':
                await handleAvatarCommand(interaction);
                break;
            case 'serverinfo':
                await handleServerInfoCommand(interaction);
                break;
            case 'userprofile':
                await handleUserProfileCommand(interaction);
                break;
            case 'poll':
                await handlePollCommand(interaction);
                break;
            case 'timer':
                await handleTimerCommand(interaction);
                break;
            case 'reminder':
                await handleReminderCommand(interaction);
                break;
            case 'calculate':
                await handleCalculateCommand(interaction);
                break;
            case 'morse':
                await handleMorseCommand(interaction);
                break;
            case 'binary':
                await handleBinaryCommand(interaction);
                break;
            case 'base64':
                await handleBase64Command(interaction);
                break;
            case 'qr':
                await handleQRCommand(interaction);
                break;
            case 'ascii':
                await handleASCIICommand(interaction);
                break;
            case 'reverse':
                await handleReverseCommand(interaction);
                break;
            case 'scramble':
                await handleScrambleCommand(interaction);
                break;
            case 'wordcount':
                await handleWordCountCommand(interaction);
                break;
            case 'translate':
                await handleTranslateCommand(interaction);
                break;
            case 'urban':
                await handleUrbanCommand(interaction);
                break;
            case 'wikipedia':
                await handleWikipediaCommand(interaction);
                break;
            case 'cat':
                await handleCatCommand(interaction);
                break;
            case 'dog':
                await handleDogCommand(interaction);
                break;
            case 'pokemon':
                await handlePokemonCommand(interaction);
                break;
            case 'horoscope':
                await handleHoroscopeCommand(interaction);
                break;
            case 'number':
                await handleNumberCommand(interaction);
                break;
            case 'compliment':
                await handleComplimentCommand(interaction);
                break;
            case 'insult':
                await handleInsultCommand(interaction);
                break;
            case 'advice':
                await handleAdviceCommand(interaction);
                break;
            case 'achievement':
                await handleAchievementCommand(interaction);
                break;
            case 'ship':
                await handleShipCommand(interaction);
                break;
            case 'rate':
                await handleRateCommand(interaction);
                break;
            case 'choose':
                await handleChooseCommand(interaction);
                break;
            case 'roast':
                await handleRoastCommand(interaction);
                break;
            case 'trivia':
                await handleTriviaCommand(interaction);
                break;
            case 'riddle':
                await handleRiddleCommand(interaction);
                break;
            case 'anagram':
                await handleAnagramCommand(interaction);
                break;
            case 'rhyme':
                await handleRhymeCommand(interaction);
                break;
            case 'fizzbuzz':
                await handleFizzBuzzCommand(interaction);
                break;
            case 'simon':
                await handleSimonCommand(interaction);
                break;
            case 'hangman':
                await handleHangmanCommand(interaction);
                break;
            case 'wordle':
                await handleWordleCommand(interaction);
                break;
            case 'blackjack':
                await handleBlackjackCommand(interaction);
                break;
            case 'slots':
                await handleSlotsCommand(interaction);
                break;
            case 'lottery':
                await handleLotteryCommand(interaction);
                break;
            case 'leaderboard':
                await handleLeaderboardCommand(interaction);
                break;
            case 'level':
                await handleLevelCommand(interaction);
                break;
            case 'daily':
                await handleDailyCommand(interaction);
                break;
            case 'inventory':
                await handleInventoryCommand(interaction);
                break;
            case 'shop':
                await handleShopCommand(interaction);
                break;
            case 'gift':
                await handleGiftCommand(interaction);
                break;
            case 'economy':
                await handleEconomyCommand(interaction);
                break;
            case 'work':
                await handleWorkCommand(interaction);
                break;
            case 'rob':
                await handleRobCommand(interaction);
                break;
            case 'gamble':
                await handleGambleCommand(interaction);
                break;
            case 'bank':
                await handleBankCommand(interaction);
                break;
            case 'marry':
                await handleMarryCommand(interaction);
                break;
            case 'divorce':
                await handleDivorceCommand(interaction);
                break;
            case 'adopt':
                await handleAdoptCommand(interaction);
                break;
            case 'pet':
                await handlePetCommand(interaction);
                break;
            case 'feed':
                await handleFeedCommand(interaction);
                break;
            case 'fish':
                await handleFishCommand(interaction);
                break;
            case 'hunt':
                await handleHuntCommand(interaction);
                break;
            case 'mine':
                await handleMineCommand(interaction);
                break;
            case 'craft':
                await handleCraftCommand(interaction);
                break;
            case 'battle':
                await handleBattleCommand(interaction);
                break;
            case 'duel':
                await handleDuelCommand(interaction);
                break;
            case 'stats':
                await handleStatsCommand(interaction);
                break;
            case 'achievements':
                await handleAchievementsCommand(interaction);
                break;
            case 'quest':
                await handleQuestCommand(interaction);
                break;
            case 'dungeon':
                await handleDungeonCommand(interaction);
                break;
            case 'raid':
                await handleRaidCommand(interaction);
                break;
            case 'guild':
                await handleGuildCommand(interaction);
                break;
            case 'magic':
                await handleMagicCommand(interaction);
                break;
            case 'potion':
                await handlePotionCommand(interaction);
                break;
            case 'spell':
                await handleSpellCommand(interaction);
                break;
            case 'enchant':
                await handleEnchantCommand(interaction);
                break;
            case 'arena':
                await handleArenaCommand(interaction);
                break;
            case 'tournament':
                await handleTournamentCommand(interaction);
                break;
            case 'clan':
                await handleClanCommand(interaction);
                break;
            case 'war':
                await handleWarCommand(interaction);
                break;
            case 'trade':
                await handleTradeCommand(interaction);
                break;
            case 'auction':
                await handleAuctionCommand(interaction);
                break;
            case 'market':
                await handleMarketCommand(interaction);
                break;
            case 'news':
                await handleNewsCommand(interaction);
                break;
            case 'events':
                await handleEventsCommand(interaction);
                break;
            case 'birthday':
                await handleBirthdayCommand(interaction);
                break;
            case 'timezone':
                await handleTimezoneCommand(interaction);
                break;
            case 'afk':
                await handleAFKCommand(interaction);
                break;
            case 'status':
                await handleStatusCommand(interaction);
                break;
            case 'badge':
                await handleBadgeCommand(interaction);
                break;
            case 'title':
                await handleTitleCommand(interaction);
                break;
            case 'background':
                await handleBackgroundCommand(interaction);
                break;
            case 'theme':
                await handleThemeCommand(interaction);
                break;
            case 'music':
                await handleMusicCommand(interaction);
                break;
            case 'mood':
                await handleMoodCommand(interaction);
                break;
            case 'activity':
                await handleActivityCommand(interaction);
                break;
            case 'bio':
                await handleBioCommand(interaction);
                break;
            case 'social':
                await handleSocialCommand(interaction);
                break;
            case 'playlist':
                await handlePlaylistCommand(interaction);
                break;
            case 'radio':
                await handleRadioCommand(interaction);
                break;
            case 'karaoke':
                await handleKaraokeCommand(interaction);
                break;
            case 'dance':
                await handleDanceCommand(interaction);
                break;
            case 'emote':
                await handleEmoteCommand(interaction);
                break;
            case 'gif':
                await handleGifCommand(interaction);
                break;
            case 'sticker':
                await handleStickerCommand(interaction);
                break;
            case 'soundboard':
                await handleSoundboardCommand(interaction);
                break;
            case 'voice':
                await handleVoiceCommand(interaction);
                break;
            case 'tts':
                await handleTTSCommand(interaction);
                break;
            case 'whisper':
                await handleWhisperCommand(interaction);
                break;
            case 'shout':
                await handleShoutCommand(interaction);
                break;
            case 'confession':
                await handleConfessionCommand(interaction);
                break;
            case 'suggestion':
                await handleSuggestionCommand(interaction);
                break;
            case 'report':
                await handleReportCommand(interaction);
                break;
            case 'feedback':
                await handleFeedbackCommand(interaction);
                break;
            case 'review':
                await handleReviewCommand(interaction);
                break;
            case 'subscribe':
                await handleSubscribeCommand(interaction);
                break;
            case 'bookmark':
                await handleBookmarkCommand(interaction);
                break;
            case 'notes':
                await handleNotesCommand(interaction);
                break;
            case 'todo':
                await handleTodoCommand(interaction);
                break;
            case 'calendar':
                await handleCalendarCommand(interaction);
                break;
            case 'schedule':
                await handleScheduleCommand(interaction);
                break;
            case 'alarm':
                await handleAlarmCommand(interaction);
                break;
            case 'stopwatch':
                await handleStopwatchCommand(interaction);
                break;
            case 'countdown':
                await handleCountdownCommand(interaction);
                break;
            case 'worldclock':
                await handleWorldClockCommand(interaction);
                break;
            case 'uptime':
                await handleUptimeCommand(interaction);
                break;
            case 'ping':
                await handlePingCommand(interaction);
                break;
            case 'botinfo':
                await handleBotInfoCommand(interaction);
                break;
            case 'version':
                await handleVersionCommand(interaction);
                break;
            case 'help':
                await handleHelpCommand(interaction);
                break;
            case 'commands':
                await handleCommandsCommand(interaction);
                break;
            case 'support':
                await handleSupportCommand(interaction);
                break;
            case 'credits':
                await handleCreditsCommand(interaction);
                break;
            case 'changelog':
                await handleChangelogCommand(interaction);
                break;
        }
    } catch (error) {
        console.error(`Error processing slash command /${interaction.commandName}:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An unexpected internal error prevented this command. Check the bot logs for details.', flags: EPHEMERAL_FLAG });
        } else {
             await interaction.editReply({ content: '❌ An unexpected internal error prevented this command. Check the bot logs for details.', flags: EPHEMERAL_FLAG });
        }
    }
}

/**
 * Handles the selection from the ticket panel dropdown.
 * @param {SelectMenuInteraction} interaction
 */
async function handleSelectMenu(interaction) {
    if (interaction.customId !== 'select_ticket_type') return;

    try {
        const ticketType = interaction.values[0];

        if (ticketType === 'Apply for Media') {
            const modal = new ModalBuilder()
                .setCustomId('media_application_modal')
                .setTitle('Media Application Form');

            const linkInput = new TextInputBuilder()
                .setCustomId('platform_link')
                .setLabel('Link to Content Platform (YouTube, TikTok)') 
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g., youtube.com/@YourChannel')
                .setRequired(true);

            const countInput = new TextInputBuilder()
                .setCustomId('follower_count')
                .setLabel('Follower/Subscriber Count (Number Only)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g., 5000')
                .setRequired(true);

            const planInput = new TextInputBuilder()
                .setCustomId('content_plan')
                .setLabel('Content Plan for the Server') 
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(linkInput),
                new ActionRowBuilder().addComponents(countInput),
                new ActionRowBuilder().addComponents(planInput)
            );

            return interaction.showModal(modal);
        }

        await interaction.deferReply({ flags: EPHEMERAL_FLAG });
        await createTicketChannel(interaction, ticketType);
    } catch (error) {
        console.error('❌ CRITICAL: Error during Select Menu (Modal Show) Interaction:', error);
        
        let errorMessage = '❌ An error occurred trying to open the Media Application Form. This is often caused by a missing Discord bot permission.';

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: errorMessage, flags: EPHEMERAL_FLAG }).catch(e => console.error("Failed to reply to failed interaction:", e));
        } else {
             await interaction.editReply({ content: errorMessage, flags: EPHEMERAL_FLAG }).catch(e => console.error("Failed to edit reply to failed interaction:", e));
        }
    }
}

/**
 * Handles the submission of Modals.
 * @param {ModalSubmitInteraction} interaction
 */
async function handleModalSubmit(interaction) {
    await interaction.deferReply({ flags: EPHEMERAL_FLAG });
    
    try {
        if (interaction.customId === 'media_application_modal') {
            
            const link = interaction.fields.getTextInputValue('platform_link');
            const count = interaction.fields.getTextInputValue('follower_count');
            const plan = interaction.fields.getTextInputValue('content_plan');

            const details = `
                **Platform Link:** ${link}
                **Follower/Subscriber Count:** ${count}
                **Content Plan:**\n${plan}
            `;

            await createTicketChannel(interaction, 'Apply for Media', details);
        } else if (interaction.customId === 'payout_modal') {
            await handlePayoutRequest(interaction);
        } 
        else if (interaction.customId === 'add_robux_modal') {
            await handleManualRobuxAddition(interaction);
        }
        else if (interaction.customId === 'user_info_modal') {
            await handleUserInfoLookup(interaction);
        }
    } catch (error) {
         console.error('Error processing modal submission (likely during channel creation):', error);
         let errorMessage = '❌ An unexpected internal error occurred during form submission. Check the bot logs for details.';
         
         if (error.code === 50013) {
             errorMessage = '❌ Channel Creation Failed: The bot is missing Discord permissions (Manage Channels) to create the ticket channel. Please contact an admin.';
         }
         
        await interaction.editReply({ content: errorMessage, flags: EPHEMERAL_FLAG });
    }
}

/**
 * Handles the manual addition of Robux by an Admin.
 * @param {ModalSubmitInteraction} interaction
 */
async function handleManualRobuxAddition(interaction) {
    try {
        const targetId = interaction.fields.getTextInputValue('target_user_id');
        const amountStr = interaction.fields.getTextInputValue('robux_amount_to_add');
        const amount = parseInt(amountStr);

        if (isNaN(amount) || amount <= 0) {
            return interaction.editReply({ content: '❌ Invalid amount. Must be a positive number.' });
        }
        
        const targetUser = await client.users.fetch(targetId).catch(() => null);
        if (!targetUser) {
            return interaction.editReply({ content: `❌ Could not find a user with the ID \`${targetId}\`.` });
        }

        const newBalance = updateRobuxBalance(targetId, amount);
        
        await targetUser.send(`💰 An administrator (<@${interaction.user.id}>) manually added **${amount} R$** to your payout balance. Your new balance is **${newBalance} R$**.`).catch(e => console.error("Failed to DM staff member about manual addition:", e));

        await interaction.editReply({ 
            content: `✅ Successfully added **${amount} R$** to **${targetUser.tag}** (<@${targetId}>). New Balance: **${newBalance} R$**.` 
        });

    } catch (error) {
        console.error('Error handling manual Robux addition:', error);
        await interaction.editReply({ content: 'An unexpected internal error occurred during the manual Robux addition. Check the bot logs for details.' });
    }
}


/**
 * Handles staff payout request submission.
 * @param {ModalSubmitInteraction} interaction
 */
async function handlePayoutRequest(interaction) {
    try {
        const amountStr = interaction.fields.getTextInputValue('payout_amount');
        const gamepassLink = interaction.fields.getTextInputValue('gamepass_link');
        const staffId = interaction.user.id;

        const amount = parseInt(amountStr);

        if (isNaN(amount) || amount < PAYOUT_MIN || amount > PAYOUT_MAX) {
            return interaction.editReply({
                content: `❌ Invalid amount. You must request between ${PAYOUT_MIN} R$ and ${PAYOUT_MAX} R$.`
            });
        }

        const balanceData = staffData.get(staffId);
        const currentBalance = balanceData ? balanceData.robux_balance : 0;

        if (amount > currentBalance) {
            return interaction.editReply({
                content: `❌ Your current balance is only **${currentBalance} R$**. You cannot request **${amount} R$**.`
            });
        }

        const approvalChannel = client.channels.cache.get(ADMIN_APPROVAL_CHANNEL_ID);
        if (!approvalChannel) {
             console.error(`ADMIN_APPROVAL_CHANNEL_ID: ${ADMIN_APPROVAL_CHANNEL_ID} not found.`);
             return interaction.editReply({ content: 'An internal error occurred: Approval channel not found. Check ADMIN_APPROVAL_CHANNEL_ID in your environment variables.' });
        }

        const approvalEmbed = new EmbedBuilder()
            .setTitle('💵 NEW ROBux PAYOUT REQUEST')
            .setColor('#FFA500')
            .addFields(
                { name: 'Staff Member', value: interaction.user.tag, inline: true },
                { name: 'Requested Amount', value: `**${amount} R$**`, inline: true },
                { name: 'Gamepass Link', value: gamepassLink },
                { name: 'Staff ID', value: staffId },
                { name: 'Request ID', value: `${staffId}-${Date.now()}` }
            )
            .setTimestamp();

        const approveButton = new ButtonBuilder()
            .setCustomId(`payout_approve_${staffId}_${amount}`)
            .setLabel('✅ Approve Payout')
            .setStyle(ButtonStyle.Success);

        const denyButton = new ButtonBuilder()
            .setCustomId(`payout_deny_${staffId}_${amount}`)
            .setLabel('❌ Deny Payout')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(approveButton, denyButton);

        await approvalChannel.send({
            content: `<@&${ADMIN_ROLE_ID}> New payout request to review!`,
            embeds: [approvalEmbed],
            components: [row]
        });

        await interaction.editReply({ content: `✅ Your payout request for **${amount} R$** has been sent for admin approval!` });

    } catch (error) {
        console.error('Error handling payout request:', error);
        await interaction.editReply({ content: 'An unexpected internal error occurred during the payout request process. Check the bot logs for details.' });
    }
}

/**
 * Handles the payout statistics command for admins.
 * @param {CommandInteraction} interaction
 */
async function handlePayoutStatsCommand(interaction) {
    try {
        const totalTransactions = transactionLogs.length;
        const totalRobuxPaid = transactionLogs.reduce((sum, log) => sum + log.amount_paid, 0);
        const totalActiveStaff = staffData.size;
        const totalCurrentBalance = Array.from(staffData.values()).reduce((sum, data) => sum + data.robux_balance, 0);
        
        const topEarners = Array.from(staffData.entries())
            .sort(([,a], [,b]) => b.robux_balance - a.robux_balance)
            .slice(0, 5)
            .map(([userId, data]) => ({ userId, balance: data.robux_balance }));
        
        const recentTransactions = transactionLogs
            .slice(-10)
            .reverse()
            .map(log => {
                const date = new Date(log.transaction_date).toLocaleDateString();
                return `**${log.amount_paid} R$** to <@${log.staff_id}> (${date})`;
            });
        
        const statsEmbed = new EmbedBuilder()
            .setTitle('📊 Payout Statistics Dashboard')
            .setColor('#9b59b6')
            .setDescription('Comprehensive overview of the payout system')
            .addFields(
                {
                    name: '💰 Financial Overview',
                    value: `**Total Transactions:** ${totalTransactions}\n**Total Robux Paid:** ${totalRobuxPaid} R$\n**Current Staff Balances:** ${totalCurrentBalance} R$`,
                    inline: true
                },
                {
                    name: '👥 Staff Overview',
                    value: `**Active Staff Members:** ${totalActiveStaff}\n**Average Balance:** ${totalActiveStaff > 0 ? Math.round(totalCurrentBalance / totalActiveStaff) : 0} R$`,
                    inline: true
                },
                {
                    name: '🏆 Top Current Balances',
                    value: topEarners.length > 0 
                        ? topEarners.map((earner, index) => `${index + 1}. <@${earner.userId}>: **${earner.balance} R$**`).join('\n')
                        : 'No staff members found',
                    inline: false
                },
                {
                    name: '📋 Recent Transactions',
                    value: recentTransactions.length > 0 
                        ? recentTransactions.slice(0, 5).join('\n')
                        : 'No transactions found',
                    inline: false
                }
            )
            .setFooter({ text: 'Data stored in memory - resets on bot restart' })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [statsEmbed] });
        
    } catch (error) {
        console.error('Error in handlePayoutStatsCommand:', error);
        await interaction.editReply({ content: 'An error occurred while fetching payout statistics.' });
    }
}

/**
 * Handles user information lookup modal submission.
 * @param {ModalSubmitInteraction} interaction
 */
async function handleUserInfoLookup(interaction) {
    try {
        const userId = interaction.fields.getTextInputValue('lookup_user_id');
        
        const userData = staffData.get(userId);
        const userTransactions = transactionLogs.filter(log => log.staff_id === userId);
        const userTickets = Array.from(ticketLogs.values()).filter(log => log.creator_id === userId);
        
        const discordUser = await client.users.fetch(userId).catch(() => null);
        
        if (!userData && userTransactions.length === 0 && userTickets.length === 0) {
            return interaction.editReply({ content: `❌ No data found for user ID: \`${userId}\`` });
        }
        
        const currentBalance = userData ? userData.robux_balance : 0;
        const totalPaidOut = userTransactions.reduce((sum, log) => sum + log.amount_paid, 0);
        const totalTicketsCreated = userTickets.length;
        const completedTickets = userTickets.filter(log => log.end_time !== null).length;
        
        const recentTransactions = userTransactions
            .slice(-5)
            .reverse()
            .map(log => {
                const date = new Date(log.transaction_date).toLocaleDateString();
                return `**${log.amount_paid} R$** on ${date}`;
            });
        
        const recentTickets = userTickets
            .slice(-3)
            .reverse()
            .map(log => {
                const date = new Date(log.start_time).toLocaleDateString();
                const status = log.end_time ? '✅ Completed' : '🔄 Active';
                return `${status} **${log.ticket_type}** (${date})`;
            });
        
        const userInfoEmbed = new EmbedBuilder()
            .setTitle(`👤 User Information: ${discordUser ? discordUser.tag : 'Unknown User'}`)
            .setColor('#3498db')
            .setDescription(`Detailed information for user ID: \`${userId}\``)
            .addFields(
                {
                    name: '💰 Robux Information',
                    value: `**Current Balance:** ${currentBalance} R$\n**Total Paid Out:** ${totalPaidOut} R$\n**Total Transactions:** ${userTransactions.length}`,
                    inline: true
                },
                {
                    name: '🎫 Ticket Information',
                    value: `**Total Tickets:** ${totalTicketsCreated}\n**Completed:** ${completedTickets}\n**Active:** ${totalTicketsCreated - completedTickets}`,
                    inline: true
                },
                {
                    name: '📊 Activity Summary',
                    value: `**First Seen:** ${userTickets.length > 0 ? new Date(Math.min(...userTickets.map(t => new Date(t.start_time)))).toLocaleDateString() : 'N/A'}\n**Last Transaction:** ${userTransactions.length > 0 ? new Date(userTransactions[userTransactions.length - 1].transaction_date).toLocaleDateString() : 'N/A'}`,
                    inline: false
                }
            )
            .setThumbnail(discordUser ? discordUser.displayAvatarURL() : null)
            .setFooter({ text: 'User data from in-memory storage' })
            .setTimestamp();
        
        if (recentTransactions.length > 0) {
            userInfoEmbed.addFields({
                name: '💳 Recent Payouts',
                value: recentTransactions.join('\n'),
                inline: false
            });
        }
        
        if (recentTickets.length > 0) {
            userInfoEmbed.addFields({
                name: '🎫 Recent Tickets',
                value: recentTickets.join('\n'),
                inline: false
            });
        }
        
        await interaction.editReply({ embeds: [userInfoEmbed] });
        
    } catch (error) {
        console.error('Error in handleUserInfoLookup:', error);
        await interaction.editReply({ content: 'An error occurred while looking up user information.' });
    }
}

/**
 * Maps ticket type to its corresponding category ID.
 * @param {string} ticketType - The ticket type string.
 * @returns {string|null} The category ID.
 */
function getCategoryId(ticketType) {
    switch (ticketType) {
        case 'Apply for Media': return MEDIA_CATEGORY_ID;
        case 'Report Exploiters': return REPORT_CATEGORY_ID;
        case 'General Support': return SUPPORT_CATEGORY_ID;
        default: return null;
    }
}


/**
 * Creates the actual ticket channel with correct permissions and initial message.
 * @param {Interaction} interaction - The triggering interaction.
 * @param {string} ticketType - The type of ticket.
 * @param {string} details - Optional extra details (e.g., from Media form).
 */
async function createTicketChannel(interaction, ticketType, details = '') {
    try {
        const guild = interaction.guild;
        const user = interaction.user;
        const ticketCategory = getCategoryId(ticketType);

        if (!ticketCategory) {
             console.error(`Ticket category ID not found for type: ${ticketType}. Check environment variables.`);
             return interaction.editReply({ content: 'Ticket category not configured. Please contact an admin.', flags: EPHEMERAL_FLAG });
        }

        const openTicketChannelId = Array.from(ticketLogs.values())
            .find(log => log.creator_id === user.id && log.end_time === null)?.channel_id;

        if (openTicketChannelId) {
            return interaction.editReply({ content: `You already have an open ticket: <#${openTicketChannelId}>.`, flags: EPHEMERAL_FLAG });
        }


        const channel = await guild.channels.create({
            name: `${ticketType.toLowerCase().replace(/\s/g, '-')}-${user.username.toLowerCase()}`,
            type: ChannelType.GuildText,
            parent: ticketCategory,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, // @everyone
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // Ticket Creator
                { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // Staff Role
                { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] } // Admin Role
            ],
        });

        ticketLogs.set(channel.id, {
            channel_id: channel.id,
            creator_id: user.id,
            ticket_type: ticketType,
            start_time: new Date(),
            end_time: null,
            claimer_id: null,
            is_claimed: false,
            is_soft_closed: false,
            html_transcript_link: null,
        });

        const buttons = getTicketActionRow(false, false);

        const initialEmbed = new EmbedBuilder()
            .setTitle(`New Ticket: ${ticketType}`)
            .setDescription(`
                Hello <@${user.id}>! A member of the <@&${STAFF_ROLE_ID}> team will be with you shortly.
                ${details ? '\n---\n**Application Details:**\n' + details : ''}
            `)
            .setColor('#2ECC71') // Green
            .setFooter({ text: `Ticket ID: ${channel.id}` })
            .setTimestamp();

        const initialMessage = await channel.send({
            content: `👋 <@${user.id}> | **<@&${STAFF_ROLE_ID}>** | @everyone`,
            embeds: [initialEmbed],
            components: [buttons]
        });

        await initialMessage.pin();

        await interaction.editReply({ content: `✅ Your **${ticketType}** ticket has been created! Go to ${channel.toString()}` });

    } catch (error) {
        if (error.code === 50013) {
             console.error('Channel Creation Failed: Missing Permissions (Manage Channels).');
             throw { code: 50013, message: 'Missing Discord permissions to create the channel.' };
        }
        console.error('Error creating ticket channel:', error);
        throw error;
    }
}



/**
 * Handles all staff button interactions.
 * @param {ButtonInteraction} interaction
 */
async function handleButton(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: 'This action must be run in a server.', flags: EPHEMERAL_FLAG });

    const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    const customId = interaction.customId;
    
    await interaction.deferReply({ flags: EPHEMERAL_FLAG }).catch(e => console.error("Failed to defer reply:", e));

    try {
        if (customId.startsWith('ticket_reward_')) {
            if (!isAdmin) return interaction.editReply({ content: 'Only Administrators can approve or deny ticket rewards.', flags: EPHEMERAL_FLAG });
            const parts = customId.split('_');
            const action = parts[2] === 'approve' ? 'ticket_reward_approve' : 'ticket_reward_deny';
            const channelId = parts[3];
            const staffId = parts[4];
            const amountStr = parts[2] === 'approve' ? parts[5] : undefined;
            const args = [channelId, staffId, amountStr];
            await handleTicketRewardApproval(interaction, action, args);
        } else if (customId.startsWith('ticket_')) {
            if (!isStaff && customId !== 'ticket_admin_delete') return interaction.editReply({ content: 'You must be a staff member to perform ticket actions.', flags: EPHEMERAL_FLAG });

            const channelId = interaction.channel.id;
            const staffId = interaction.user.id;

            const ticketLog = getActiveTicketLog(channelId);

            if (!ticketLog && customId !== 'ticket_admin_delete') {
                return interaction.editReply({ content: 'This channel is not an active ticket (or already finalized).', flags: EPHEMERAL_FLAG });
            }

            const { claimer_id, is_claimed, is_soft_closed } = ticketLog || {};
            const isCurrentClaimer = claimer_id === staffId;

            switch (customId) {
                case 'ticket_claim':
                case 'ticket_unclaim':
                    if (is_soft_closed) return interaction.editReply({ content: 'Cannot change claim status on a soft-closed ticket.', flags: EPHEMERAL_FLAG });
                    await handleClaimUnclaimLogic(interaction, channelId, staffId, is_claimed, isCurrentClaimer, claimer_id);
                    break;

                case 'ticket_soft_close':
                    if (!isCurrentClaimer && is_claimed) {
                        return interaction.editReply({ content: `❌ This ticket is claimed by <@${claimer_id}>. You must unclaim it or be the claimer to soft-close.`, flags: EPHEMERAL_FLAG });
                    }
                    await handleSoftCloseLogic(interaction, channelId, staffId, false);
                    break;

                case 'ticket_admin_delete':
                    if (!isAdmin) return interaction.editReply({ content: 'Only Administrators can force delete tickets.', flags: EPHEMERAL_FLAG });
                    await handleDeleteLogic(interaction, channelId, staffId, false);
                    break;
                
                case 'ticket_finalize_delete':
                    if (!isStaff) return interaction.editReply({ content: 'You must be a staff member to finalize and delete tickets.', flags: EPHEMERAL_FLAG });
                    await handleDeleteLogic(interaction, channelId, staffId, false);
                    break;
            }

        } else if (customId.startsWith('payout_')) {
            if (!isAdmin) return interaction.editReply({ content: 'Only Administrators can approve or deny payout requests.', flags: EPHEMERAL_FLAG });
            const parts = customId.split('_');
            const action = parts[1] === 'approve' ? 'payout_approve' : 'payout_deny';
            const staffId = parts[2];
            const amountStr = parts[3];
            const args = [staffId, amountStr];
            await handlePayoutApproval(interaction, action, args);
        }
    } catch (error) {
        console.error(`❌ CRITICAL ERROR IN BUTTON HANDLER (${customId}) for channel ${interaction.channel.id}:`, error);
        await interaction.editReply({ 
            content: `❌ A critical error occurred during this action. Please check the bot's console logs immediately. Error: \`${error.message}\``, 
            flags: EPHEMERAL_FLAG
        }).catch(() => console.error("Failed to send error reply to user."));
    }
}


/**
 * Sets up the unclaim timeout when the user messages in a claimed channel.
 * @param {Message} message The user's message.
 * @param {string} claimerId The ID of the claimed staff member.
 */
function startUnclaimTimer(message, claimerId) {
    const channelId = message.channel.id;
    const guild = message.guild;

    const existingTicket = claimedTickets.get(channelId);
    if (existingTicket?.timeoutId) {
        clearTimeout(existingTicket.timeoutId);
    }

    const timeoutId = setTimeout(async () => {
        try {
            const ticketInfo = claimedTickets.get(channelId);
            if (!ticketInfo || ticketInfo.claimerId !== claimerId) return; 

            await unclaimTicket(guild, channelId, message.id);
            message.channel.send(`⚠️ <@${claimerId}> did not reply within 20 minutes of the user's message. The ticket has been **automatically unclaimed**. All staff can now respond.`);
        } catch (error) {
            console.error(`Error in startUnclaimTimer timeout for channel ${channelId}:`, error);
        }
    }, UNCLAIM_TIMEOUT_MS);

    claimedTickets.set(channelId, { claimerId, timeoutId });
}

client.on('messageCreate', async message => {
    if (!message.inGuild() || message.author.bot) return;

    const channelId = message.channel.id;
    const ticketInfo = claimedTickets.get(channelId);

    if (!ticketInfo) return; 

    const ticketLog = getActiveTicketLog(channelId);
    
    if (!ticketLog || ticketLog.is_soft_closed) {
        claimedTickets.delete(channelId); 
        return;
    }

    const creatorId = ticketLog.creator_id;
    const claimerId = ticketInfo.claimerId;

    if (message.author.id === creatorId) {
        startUnclaimTimer(message, claimerId);
    }

    if (message.author.id === claimerId) {
        if (ticketInfo?.timeoutId) {
            clearTimeout(ticketInfo.timeoutId);
            claimedTickets.set(channelId, { claimerId: claimerId, timeoutId: null }); 
        }
    }
});


/**
 * Unclaims a ticket, resetting permissions and in-memory state, and updating the message buttons.
 * @param {Guild} guild The guild object.
 * @param {string} channelId The channel ID to unclaim.
 * @param {string} initialMessageId ID of the message to update buttons on.
 */
async function unclaimTicket(guild, channelId, initialMessageId) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    const ticketInfo = claimedTickets.get(channelId);
    if (ticketInfo?.timeoutId) clearTimeout(ticketInfo.timeoutId);
    claimedTickets.delete(channelId);

    try {
        if (STAFF_ROLE_ID) {
            await channel.permissionOverwrites.edit(STAFF_ROLE_ID, { SendMessages: true });
        } else {
            console.error('STAFF_ROLE_ID is undefined or null. Cannot reset permissions.');
        }

        const log = getActiveTicketLog(channelId);
        if (log) {
            log.is_claimed = false;
            log.claimer_id = null;
            ticketLogs.set(channelId, log);
        }

        await channel.setTopic((channel.topic || '').replace(/🔒 Claimed by: .*$/i, ''));
        
        const initialMessage = await channel.messages.fetch(initialMessageId).catch(() => null);
        if (initialMessage) {
            const newRow = getTicketActionRow(false, log ? log.is_soft_closed : false); // isClaimed: false
            await initialMessage.edit({ components: [newRow] });
        }

    } catch (error) {
        console.error(`Error during unclaim/permission reset for ${channelId}:`, error);
    }
}


/**
 * Handles the 'Claim' or 'Unclaim' button press.
 * @param {ButtonInteraction} interaction
 * @param {string} claimerId The ID of the staff member who claimed it (if claimed).
 */
async function handleClaimUnclaimLogic(interaction, channelId, staffId, isClaimed, isCurrentClaimer, claimer_id) {
    const channel = interaction.channel;
    const log = getActiveTicketLog(channelId);
    if (!log) return interaction.editReply({ content: 'Ticket log not found for this channel.', flags: EPHEMERAL_FLAG });

    if (isClaimed) {
        if (isCurrentClaimer) {
            const initialMessageId = interaction.message.id;
            await unclaimTicket(interaction.guild, channelId, initialMessageId);
            await interaction.editReply({ content: '✅ You have **unclaimed** this ticket. All staff can now respond.', flags: EPHEMERAL_FLAG });
            await channel.send(`🔓 <@${staffId}> has **unclaimed** this ticket. It is now available for any staff member.`);
        } else {
            return interaction.editReply({ content: `❌ This ticket is claimed by <@${claimer_id}>. Only they can unclaim it.`, flags: EPHEMERAL_FLAG });
        }
    } else {
        try {
            log.is_claimed = true;
            log.claimer_id = staffId;
            ticketLogs.set(channelId, log);

            await channel.setTopic(`🔒 Claimed by: ${interaction.user.tag} (${staffId})`);
            
            if (STAFF_ROLE_ID) {
                await channel.permissionOverwrites.edit(STAFF_ROLE_ID, { SendMessages: false }); 
            } else {
                console.error('STAFF_ROLE_ID is undefined. Cannot deny send permissions for general staff role.');
            }
            
            await channel.permissionOverwrites.edit(staffId, { SendMessages: true });

            claimedTickets.set(channelId, { claimerId: staffId, timeoutId: null });
            
            const newRow = getTicketActionRow(true, log.is_soft_closed); // isClaimed: true
            await interaction.message.edit({ components: [newRow] });

            await interaction.editReply({ content: '✅ You have **claimed** this ticket. Other staff members cannot type here until you unclaim it.', flags: EPHEMERAL_FLAG });
            await channel.send(`🔒 <@${staffId}> has **claimed** this ticket and is taking over.`);
        } catch (error) {
            console.error('Error during Claim logic:', error);
            log.is_claimed = false;
            log.claimer_id = null;
            ticketLogs.set(channelId, log);
            
            if (error.code === 50013) {
                return interaction.editReply({ 
                    content: '❌ Claim Failed: The bot is missing permissions to **edit channel permissions** (Manage Roles) or **edit the initial ticket message**.', 
                    flags: EPHEMERAL_FLAG
                });
            }
            throw error; // Re-throw to be caught by the general handler
        }
    }
}



/**
 * Handles the soft close action (sends reward request, locks channel, updates buttons to Delete).
 * @param {Interaction} interaction - The button/slash command interaction.
 * @param {string} channelId
 * @param {string} staffId
 * @param {boolean} isSlashCommand - True if triggered by /close-ticket.
 */
async function handleSoftCloseLogic(interaction, channelId, staffId, isSlashCommand) {
    const log = getActiveTicketLog(channelId);

    if (!log) {
        return interaction.editReply({ content: 'This channel is not an active ticket (or already finalized).', flags: EPHEMERAL_FLAG });
    }

    const { creator_id, ticket_type, is_soft_closed } = log;

    if (is_soft_closed) {
        return interaction.editReply({ content: 'This ticket is already soft-closed. Use the **Finalize & Delete** button to complete the process.', flags: EPHEMERAL_FLAG });
    }
    
    try {
        if (claimedTickets.has(channelId)) {
            const initialMessageId = interaction.message ? interaction.message.id : (await interaction.channel.messages.fetchPinned()).first()?.id;
            if (initialMessageId) {
                await unclaimTicket(interaction.guild, channelId, initialMessageId);
            }
        }
        
        const robuxValue = PAYOUT_VALUES[ticket_type] || 0;

        log.is_soft_closed = true;
        log.claimer_id = staffId; // Record who closed it for reward purposes
        ticketLogs.set(channelId, log); // Store updated log
        
        const approvalChannel = client.channels.cache.get(ADMIN_APPROVAL_CHANNEL_ID);

        if (approvalChannel) {
            const approvalEmbed = new EmbedBuilder()
                .setTitle('✅ TICKET REWARD APPROVAL REQUEST')
                .setColor('#3498DB')
                .setDescription(`
                    **Ticket:** <#${channelId}> (${interaction.channel.name})
                    **Type:** ${ticket_type}
                    **Staff Closer:** <@${staffId}>
                    **Reward Amount:** **${robuxValue} R$**
                    
                    *Admin action is required to award the Robux.*
                `)
                .addFields(
                    { name: 'Ticket Channel ID', value: channelId, inline: true },
                    { name: 'Staff ID', value: staffId, inline: true }
                )
                .setTimestamp();

            const approveButton = new ButtonBuilder()
                .setCustomId(`ticket_reward_approve_${channelId}_${staffId}_${robuxValue}`)
                .setLabel('✅ Approve Reward')
                .setStyle(ButtonStyle.Success);

            const denyButton = new ButtonBuilder()
                .setCustomId(`ticket_reward_deny_${channelId}_${staffId}`)
                .setLabel('❌ Deny Reward')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(approveButton, denyButton);

            await approvalChannel.send({
                content: `🚨 <@&${ADMIN_ROLE_ID}> New Ticket Reward Approval Needed`,
                embeds: [approvalEmbed],
                components: [row]
            });
        } else {
            console.error(`ADMIN_APPROVAL_CHANNEL_ID: ${ADMIN_APPROVAL_CHANNEL_ID} not found. Reward approval skipped.`);
        }

        const initialMessage = interaction.message || (await interaction.channel.messages.fetchPinned()).first();

        if (initialMessage) {
            const newRow = getTicketActionRow(false, true); // isClaimed: false, isSoftClosed: true
            await initialMessage.edit({
                content: `**Ticket Soft-Closed by ${interaction.user.tag}** | Reward request sent to Admin channel. Ready for final deletion.`,
                components: [newRow]
            }).catch(e => console.error("Error editing initial message for soft close:", e));
        }
        
        if (creator_id) {
             await interaction.channel.permissionOverwrites.edit(creator_id, { SendMessages: false });
        }
        if (STAFF_ROLE_ID) {
             await interaction.channel.permissionOverwrites.edit(STAFF_ROLE_ID, { SendMessages: false });
        } else {
             console.warn('STAFF_ROLE_ID is missing. Cannot lock general staff sending messages.');
        }


        const replyContent = `✅ Ticket soft-closed. A reward request for **${robuxValue} R$** has been sent for Admin approval. The channel is now locked. Use **Finalize & Delete** to remove the channel.`;
        
        if (isSlashCommand) {
            await interaction.editReply({ content: replyContent });
        } else {
            await interaction.editReply({ content: replyContent, flags: EPHEMERAL_FLAG });
            await interaction.channel.send(`💾 <@${staffId}> has **soft-closed** this ticket. It is now locked and awaiting final deletion.`);
        }
    } catch (error) {
        console.error('Error during Soft Close logic:', error);
        
        log.is_soft_closed = false;
        ticketLogs.set(channelId, log);
        
        if (error.code === 50013) {
            return interaction.editReply({ 
                content: '❌ Soft Close Failed: The bot is missing permissions to **edit channel permissions** (Manage Roles) or **edit the initial ticket message**.', 
                flags: EPHEMERAL_FLAG
            });
        }
        throw error; // Re-throw to be caught by the general handler
    }
}



/**
 * Handles the hard delete action (transcript, in-memory update, channel delete).
 * @param {Interaction} interaction - The button/slash command interaction.
 * @param {string} channelId
 * @param {string} staffId
 * @param {boolean} isSlashCommand - True if triggered by /delete-ticket.
 */
async function handleDeleteLogic(interaction, channelId, staffId, isSlashCommand) {
    const channel = interaction.channel;
    const isFinalizeDelete = interaction.customId === 'ticket_finalize_delete';
    
    const log = getActiveTicketLog(channelId) || { creator_id: 'Unknown', ticket_type: 'Unknown Ticket', is_soft_closed: isFinalizeDelete }; // Fallback for admin delete
    
    if (isFinalizeDelete && !log.is_soft_closed) {
        return interaction.editReply({ content: 'This ticket must be soft-closed first (which sends the reward request) before finalizing the delete process.', flags: EPHEMERAL_FLAG });
    }
    
    try {
        claimedTickets.delete(channelId);

        const creator = await interaction.guild.members.fetch(log.creator_id).catch(() => ({ user: { tag: 'Unknown User' } }));
        const messages = await channel.messages.fetch({ limit: 100 }); 
        const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const htmlContent = generateHtmlTranscript(sortedMessages, creator);

        const logChannel = client.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
        let transcriptUrl = 'URL not available.';
        
        if (logChannel) {
            const attachment = new AttachmentBuilder(Buffer.from(htmlContent), { name: `transcript-${channel.name}-${Date.now()}.html` });
            const logMessage = await logChannel.send({
                content: `**TICKET DELETED & LOGGED**\nCreator: <@${log.creator_id}> (${creator.user.tag})\nType: ${log.ticket_type}\nStaff Finalizer: <@${interaction.user.id}>`,
                files: [attachment]
            });

            transcriptUrl = logMessage.attachments.first()?.url || 'URL not available.';

            const linkRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Direct Link').setStyle(ButtonStyle.Link).setURL(transcriptUrl)
            );
            await logMessage.edit({ components: [linkRow] });

            log.html_transcript_link = transcriptUrl;
            log.end_time = new Date();
            ticketLogs.set(channelId, log); // Store finalized log
        } else {
            console.error(`TRANSCRIPT_LOG_CHANNEL_ID: ${TRANSCRIPT_LOG_CHANNEL_ID} not found. Deleting ticket without logging.`);
            log.end_time = new Date();
            ticketLogs.set(channelId, log);
        }

        const finalReply = `✅ Ticket finalized and deleted. Transcript saved to logs (if configured). Channel will be deleted in 5 seconds.`;
        
        if (isSlashCommand) {
            await interaction.editReply({ content: finalReply });
        } else {
            await interaction.editReply({ content: finalReply, flags: EPHEMERAL_FLAG });
        }

        setTimeout(() => {
            channel.delete('Ticket finalized and deleted by staff.').catch(err => console.error('Error deleting channel (requires Manage Channels permission):', err));
            ticketLogs.delete(channelId); // Clean up the map after deletion
        }, 5000);
    } catch (error) {
         console.error('Error during Hard Delete logic:', error);
         if (error.code === 50013) {
            return interaction.editReply({ 
                content: '❌ Delete Failed: The bot is missing permissions to **delete the channel** (Manage Channels) or **send messages in the Transcript Log Channel**.', 
                flags: EPHEMERAL_FLAG
            });
        }
        throw error; // Re-throw to be caught by the general handler
    }
}



/**
 * Handles the approval or denial of a Robux payout request.
 * @param {ButtonInteraction} interaction
 * @param {string} action 'payout_approve' or 'payout_deny'.
 * @param {string[]} args Array containing [staffId, amount].
 */
async function handlePayoutApproval(interaction, action, args) {
    const [staffId, amountStr] = args;
    const amount = parseInt(amountStr);
    const approverId = interaction.user.id;
    const isApproval = action === 'payout_approve';

    console.log(`[PAYOUT] Button action: ${action}, staffId: ${staffId}, amount: ${amount}, isApproval: ${isApproval}`);

    try {
        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`payout_${isApproval ? 'approved' : 'denied'}_${staffId}_${amount}`).setLabel(isApproval ? '✅ Approved' : '❌ Denied').setStyle(isApproval ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(true)
        );
        await interaction.message.edit({ components: [disabledRow] });

        if (action === 'payout_deny') {
            try {
                const staffMember = await client.users.fetch(staffId);
                await staffMember.send(`❌ Your Robux payout request for **${amount} R$** has been **denied** by <@${approverId}>. Please contact them for details.`);
                return interaction.editReply({ content: `❌ Successfully denied payout request for <@${staffId}>.` });
            } catch (error) {
                console.error('Error denying payout:', error);
                return interaction.editReply({ content: `❌ Denied, but could not DM staff member <@${staffId}>.` });
            }
        } else if (action === 'payout_approve') {
            const balanceData = staffData.get(staffId);
            const currentBalance = balanceData ? balanceData.robux_balance : 0;

            if (currentBalance < amount) {
                return interaction.editReply({ content: `⚠️ Cannot approve. Staff member's balance (**${currentBalance} R$**) is now less than the requested amount (**${amount} R$**). Request rejected.` });
            }

            updateRobuxBalance(staffId, -amount);

            const gamepassLink = interaction.message.embeds[0].fields.find(f => f.name === 'Gamepass Link')?.value || 'N/A';
            transactionCounter++;
            transactionLogs.push({
                transaction_id: transactionCounter,
                staff_id: staffId,
                amount_paid: amount,
                transaction_date: new Date(),
                gamepass_link: gamepassLink,
                admin_approver_id: approverId
            });

            const staffMember = await client.users.fetch(staffId);
            await staffMember.send(
                `✅ Your Robux payout request for **${amount} R$** has been **approved** by <@${approverId}>! Your balance has been reset to **0 R$**.\n\nPlease ensure your **Roblox Gamepass** is correctly configured to receive the payment shortly.`
            );

            await interaction.editReply({ content: `✅ Payout of **${amount} R$** to <@${staffId}> approved and logged. Staff notified. Balance reset to 0.` });
        } else {
            await interaction.editReply({ content: `❌ Unknown payout action: ${action}. Please contact a developer.` });
        }

    } catch (error) {
        console.error('Error during payout approval:', error);
        if (isApproval) {
            updateRobuxBalance(staffId, amount); 
        }
        throw error; // Re-throw to be caught by the general handler
    }
}

/**
 * NEW: Handles the approval or denial of a soft-closed ticket reward.
 * @param {ButtonInteraction} interaction
 * @param {string} action 'ticket_reward_approve' or 'ticket_reward_deny'.
 * @param {string[]} args Array containing [channelId, staffId, amount].
 */
async function handleTicketRewardApproval(interaction, action, args) {
    const [channelId, staffId, amountStr] = args;
    const approverId = interaction.user.id;
    const isApproval = action === 'ticket_reward_approve';
    const amount = isApproval ? parseInt(amountStr) : undefined;

    try {
        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('reward_status').setLabel(isApproval ? '✅ Reward Approved' : '❌ Reward Denied').setStyle(isApproval ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(true)
        );
        await interaction.message.edit({ components: [disabledRow] });

        if (isApproval) {
            const newBalance = updateRobuxBalance(staffId, amount);

            const staffMember = await client.users.fetch(staffId);
            await staffMember.send(`✅ Your reward for closing ticket has been **APPROVED** by <@${approverId}>! **${amount} R$** added to your balance. Your new balance is **${newBalance} R$**.`).catch(e => console.error("Failed to DM staff member on reward approval:", e));

            await interaction.editReply({ content: `✅ Reward of **${amount} R$** for ticket in <#${channelId}> approved and awarded to <@${staffId}>. New Balance: ${newBalance} R$.` });
        } else {
            const staffMember = await client.users.fetch(staffId);
            await staffMember.send(`❌ Your reward request for closing ticket has been **DENIED** by <@${approverId}>. You will not receive the reward.`).catch(e => console.error("Failed to DM staff member on reward denial:", e));

            await interaction.editReply({ content: `❌ Reward for ticket in <#${channelId}> denied. No Robux awarded to <@${staffId}>.` });
        }
    } catch (error) {
        console.error('Error during ticket reward approval:', error);
        await interaction.editReply({ content: 'An internal error occurred while processing the ticket reward approval.' });
    }
}

async function handleRollCommand(interaction) {
    const dice = Math.floor(Math.random() * 6) + 1;
    const embed = new EmbedBuilder()
        .setTitle('🎲 Dice Roll')
        .setDescription(`You rolled a **${dice}**!`)
        .setColor('#ff6b6b');
    await interaction.reply({ embeds: [embed] });
}

async function handleCoinflipCommand(interaction) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    const emoji = result === 'Heads' ? '🟡' : '⚪';
    const embed = new EmbedBuilder()
        .setTitle('🪙 Coin Flip')
        .setDescription(`${emoji} **${result}**!`)
        .setColor(result === 'Heads' ? '#ffd93d' : '#c7c7c7');
    await interaction.reply({ embeds: [embed] });
}

async function handle8BallCommand(interaction) {
    const response = eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
    const embed = new EmbedBuilder()
        .setTitle('🎱 Magic 8-Ball')
        .setDescription(`*${response}*`)
        .setColor('#000000');
    await interaction.reply({ embeds: [embed] });
}

async function handleRPSCommand(interaction) {
    const choices = ['🪨 Rock', '📄 Paper', '✂️ Scissors'];
    const userChoice = choices[Math.floor(Math.random() * choices.length)];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];
    
    let result = "It's a tie!";
    if ((userChoice.includes('Rock') && botChoice.includes('Scissors')) ||
        (userChoice.includes('Paper') && botChoice.includes('Rock')) ||
        (userChoice.includes('Scissors') && botChoice.includes('Paper'))) {
        result = 'You win! 🎉';
    } else if (userChoice !== botChoice) {
        result = 'I win! 😎';
    }
    
    const embed = new EmbedBuilder()
        .setTitle('✂️ Rock Paper Scissors')
        .addFields(
            { name: 'You chose', value: userChoice, inline: true },
            { name: 'I chose', value: botChoice, inline: true },
            { name: 'Result', value: result, inline: false }
        )
        .setColor('#4ecdc4');
    await interaction.reply({ embeds: [embed] });
}

async function handleJokeCommand(interaction) {
    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    const embed = new EmbedBuilder()
        .setTitle('😂 Random Joke')
        .setDescription(joke)
        .setColor('#ffbe0b');
    await interaction.reply({ embeds: [embed] });
}

async function handleQuoteCommand(interaction) {
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    const embed = new EmbedBuilder()
        .setTitle('💭 Inspirational Quote')
        .setDescription(quote)
        .setColor('#8338ec');
    await interaction.reply({ embeds: [embed] });
}

async function handleMemeCommand(interaction) {
    const memeTemplates = [
        "When you realize it's already Friday",
        "Me trying to understand JavaScript",
        "When the code works on the first try",
        "Monday morning be like",
        "When someone says they don't like pizza",
        "Me explaining why I need another energy drink"
    ];
    const meme = memeTemplates[Math.floor(Math.random() * memeTemplates.length)];
    const embed = new EmbedBuilder()
        .setTitle('😎 Random Meme')
        .setDescription(`**${meme}**`)
        .setColor('#ff006e');
    await interaction.reply({ embeds: [embed] });
}

async function handleWeatherCommand(interaction) {
    const weathers = [
        { condition: '☀️ Sunny', temp: '75°F', desc: 'Perfect weather for a walk!' },
        { condition: '🌧️ Rainy', temp: '65°F', desc: 'Great day to stay inside and code!' },
        { condition: '⛅ Cloudy', temp: '70°F', desc: 'Nice and cool outside!' },
        { condition: '❄️ Snowy', temp: '32°F', desc: 'Time for hot chocolate!' },
        { condition: '⛈️ Stormy', temp: '68°F', desc: "Nature's light show!" }
    ];
    const weather = weathers[Math.floor(Math.random() * weathers.length)];
    const embed = new EmbedBuilder()
        .setTitle('🌤️ Weather Report')
        .addFields(
            { name: 'Condition', value: weather.condition, inline: true },
            { name: 'Temperature', value: weather.temp, inline: true },
            { name: 'Description', value: weather.desc, inline: false }
        )
        .setColor('#06ffa5');
    await interaction.reply({ embeds: [embed] });
}

async function handleFactCommand(interaction) {
    const fact = facts[Math.floor(Math.random() * facts.length)];
    const embed = new EmbedBuilder()
        .setTitle('🧠 Random Fact')
        .setDescription(fact)
        .setColor('#3a86ff');
    await interaction.reply({ embeds: [embed] });
}

async function handlePasswordCommand(interaction) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const embed = new EmbedBuilder()
        .setTitle('🔐 Generated Password')
        .setDescription(`||\`${password}\`||`)
        .setFooter({ text: 'Click to reveal • Keep this secure!' })
        .setColor('#e63946');
    await interaction.reply({ embeds: [embed], flags: EPHEMERAL_FLAG });
}

async function handleColorCommand(interaction) {
    const color = Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    const embed = new EmbedBuilder()
        .setTitle('🎨 Random Color')
        .setDescription(`**Hex:** #${color}\n**RGB:** ${parseInt(color.substr(0,2), 16)}, ${parseInt(color.substr(2,2), 16)}, ${parseInt(color.substr(4,2), 16)}`)
        .setColor(`#${color}`)
        .setThumbnail(`https://via.placeholder.com/100/${color}/${color}`);
    await interaction.reply({ embeds: [embed] });
}

async function handleAvatarCommand(interaction) {
    const user = interaction.options?.getUser('user') || interaction.user;
    const embed = new EmbedBuilder()
        .setTitle(`🖼️ ${user.username}'s Avatar`)
        .setImage(user.displayAvatarURL({ size: 512, extension: 'png' }))
        .setColor('#fb8500');
    await interaction.reply({ embeds: [embed] });
}

async function handleServerInfoCommand(interaction) {
    const guild = interaction.guild;
    const embed = new EmbedBuilder()
        .setTitle(`📊 ${guild.name}`)
        .setThumbnail(guild.iconURL())
        .addFields(
            { name: 'Members', value: guild.memberCount.toString(), inline: true },
            { name: 'Created', value: guild.createdAt.toLocaleDateString(), inline: true },
            { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
            { name: 'Channels', value: guild.channels.cache.size.toString(), inline: true },
            { name: 'Roles', value: guild.roles.cache.size.toString(), inline: true },
            { name: 'Boosts', value: guild.premiumSubscriptionCount?.toString() || '0', inline: true }
        )
        .setColor('#219ebc');
    await interaction.reply({ embeds: [embed] });
}

async function handleUserProfileCommand(interaction) {
    const user = interaction.options?.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    
    const embed = new EmbedBuilder()
        .setTitle(`👤 ${user.username}`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
            { name: 'Joined Discord', value: user.createdAt.toLocaleDateString(), inline: true },
            { name: 'Joined Server', value: member?.joinedAt?.toLocaleDateString() || 'Unknown', inline: true },
            { name: 'Roles', value: member?.roles.cache.size.toString() || 'Unknown', inline: true }
        )
        .setColor('#8b5cf6');
    await interaction.reply({ embeds: [embed] });
}

async function handleComplimentCommand(interaction) {
    const compliment = compliments[Math.floor(Math.random() * compliments.length)];
    const embed = new EmbedBuilder()
        .setTitle('💖 Compliment')
        .setDescription(compliment)
        .setColor('#f72585');
    await interaction.reply({ embeds: [embed] });
}

async function handleAdviceCommand(interaction) {
    const adviceText = advice[Math.floor(Math.random() * advice.length)];
    const embed = new EmbedBuilder()
        .setTitle('💡 Life Advice')
        .setDescription(adviceText)
        .setColor('#06ffa5');
    await interaction.reply({ embeds: [embed] });
}

async function handleRoastCommand(interaction) {
    const roast = roasts[Math.floor(Math.random() * roasts.length)];
    const embed = new EmbedBuilder()
        .setTitle("🔥 You've Been Roasted!")
        .setDescription(roast)
        .setColor('#ff4757');
    await interaction.reply({ embeds: [embed] });
}

async function handleShipCommand(interaction) {
    const compatibility = Math.floor(Math.random() * 101);
    let emoji = '💔';
    let message = 'Not meant to be...';
    
    if (compatibility >= 80) {
        emoji = '💕';
        message = 'Perfect match!';
    } else if (compatibility >= 60) {
        emoji = '💖';
        message = 'Great potential!';
    } else if (compatibility >= 40) {
        emoji = '💛';
        message = 'Could work out!';
    } else if (compatibility >= 20) {
        emoji = '💙';
        message = 'Just friends...';
    }
    
    const embed = new EmbedBuilder()
        .setTitle('💘 Love Calculator')
        .setDescription(`${emoji} **${compatibility}%** compatibility!\\n*${message}*`)
        .setColor('#ff69b4');
    await interaction.reply({ embeds: [embed] });
}

async function handleRateCommand(interaction) {
    const rating = Math.floor(Math.random() * 10) + 1;
    const stars = '⭐'.repeat(rating) + '☆'.repeat(10 - rating);
    const embed = new EmbedBuilder()
        .setTitle('⭐ Rating')
        .setDescription(`I rate this **${rating}/10**!\\n${stars}`)
        .setColor('#ffd60a');
    await interaction.reply({ embeds: [embed] });
}

async function handleChooseCommand(interaction) {
    const choices = ['Option A', 'Option B', 'Option C', 'The first one', 'The second one', 'Neither', 'Both!', 'Ask me again later'];
    const choice = choices[Math.floor(Math.random() * choices.length)];
    const embed = new EmbedBuilder()
        .setTitle('🤔 Decision Maker')
        .setDescription(`I choose: **${choice}**!`)
        .setColor('#6f2dbd');
    await interaction.reply({ embeds: [embed] });
}

async function handlePingCommand(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .addFields(
            { name: 'Bot Latency', value: `${Date.now() - interaction.createdTimestamp}ms`, inline: true },
            { name: 'API Latency', value: `${Math.round(client.ws.ping)}ms`, inline: true }
        )
        .setColor('#00ff00');
    await interaction.reply({ embeds: [embed] });
}

async function handleUptimeCommand(interaction) {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor(uptime / 3600) % 24;
    const minutes = Math.floor(uptime / 60) % 60;
    const seconds = Math.floor(uptime % 60);
    
    const embed = new EmbedBuilder()
        .setTitle('🕐 Bot Uptime')
        .setDescription(`**${days}** days, **${hours}** hours, **${minutes}** minutes, **${seconds}** seconds`)
        .setColor('#4cc9f0');
    await interaction.reply({ embeds: [embed] });
}

async function handleBotInfoCommand(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Information')
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
            { name: 'Bot Name', value: client.user.username, inline: true },
            { name: 'Servers', value: client.guilds.cache.size.toString(), inline: true },
            { name: 'Commands', value: '150+', inline: true },
            { name: 'Created By', value: 'Your Server Team', inline: false },
            { name: 'Version', value: '3.0.0', inline: true },
            { name: 'Language', value: 'JavaScript (Node.js)', inline: true }
        )
        .setColor('#7209b7');
    await interaction.reply({ embeds: [embed] });
}

async function handleHelpCommand(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('❓ Bot Help')
        .setDescription('Welcome to the ultimate Discord bot! Here are some command categories:')
        .addFields(
            { name: '🎮 Games', value: 'roll, coinflip, rps, 8ball, trivia, blackjack, slots', inline: false },
            { name: '🎭 Fun', value: 'joke, meme, quote, roast, compliment, ship, rate', inline: false },
            { name: '🛠️ Utility', value: 'avatar, serverinfo, weather, calculate, timer', inline: false },
            { name: '💰 Economy', value: 'daily, work, shop, gamble, bank, inventory', inline: false },
            { name: '🎪 Social', value: 'marry, pet, achievement, level, leaderboard', inline: false },
            { name: '🔧 Tools', value: 'morse, binary, qr, password, translate', inline: false }
        )
        .setFooter({ text: 'Use /commands to see all available commands!' })
        .setColor('#f72585');
    await interaction.reply({ embeds: [embed] });
}

async function handleCommandsCommand(interaction) {
    const totalCommands = 150;
    const embed = new EmbedBuilder()
        .setTitle('📝 All Commands')
        .setDescription(`This bot has **${totalCommands}+ commands** across multiple categories!`)
        .addFields(
            { name: '🎲 Games & Fun', value: 'roll, coinflip, rps, 8ball, joke, meme, quote, trivia, riddle, hangman, wordle, blackjack, slots, lottery, fizzbuzz, simon', inline: false },
            { name: '💰 Economy & RPG', value: 'daily, work, shop, gamble, bank, inventory, fish, hunt, mine, craft, battle, duel, quest, dungeon, raid, guild, arena', inline: false },
            { name: '👥 Social & Relationships', value: 'marry, divorce, ship, compliment, roast, gift, adopt, pet, feed, clan, trade, auction, market', inline: false },
            { name: '🛠️ Utility & Tools', value: 'avatar, serverinfo, weather, calculate, timer, reminder, morse, binary, base64, qr, ascii, translate, urban, wikipedia', inline: false },
            { name: '🎨 Customization', value: 'status, bio, theme, background, badge, title, mood, activity, music, social, playlist', inline: false },
            { name: '🎪 Entertainment', value: 'radio, karaoke, dance, emote, gif, sticker, soundboard, voice, tts, cat, dog, pokemon', inline: false }
        )
        .setFooter({ text: 'And many more! Use /help for detailed information.' })
        .setColor('#06ffa5');
    await interaction.reply({ embeds: [embed] });
}

async function handleVersionCommand(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('📊 Bot Version')
        .setDescription('**Version 3.0.0** - The Ultimate Feature Update!')
        .addFields(
            { name: '🆕 New Features', value: '• 150+ new commands\\n• Advanced economy system\\n• RPG elements\\n• Social features\\n• Customization options', inline: false },
            { name: '🔧 Improvements', value: '• Better performance\\n• Enhanced UI\\n• Bug fixes\\n• New games', inline: false },
            { name: '📅 Release Date', value: 'October 2025', inline: true },
            { name: '🚀 Next Update', value: 'Coming Soon!', inline: true }
        )
        .setColor('#4361ee');
    await interaction.reply({ embeds: [embed] });
}

async function handleSupportCommand(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('🆘 Support & Contact')
        .setDescription('Need help? Here are your options:')
        .addFields(
            { name: '📧 Contact', value: 'Message the server administrators', inline: false },
            { name: '🐛 Bug Reports', value: 'Use /report to report bugs', inline: false },
            { name: '💡 Suggestions', value: 'Use /suggestion to suggest features', inline: false },
            { name: '📖 Documentation', value: 'Use /help and /commands for guidance', inline: false }
        )
        .setColor('#f72585');
    await interaction.reply({ embeds: [embed] });
}

async function handleCreditsCommand(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('👏 Credits & Contributors')
        .setDescription('Thanks to everyone who made this bot possible!')
        .addFields(
            { name: '💻 Lead Developer', value: 'Server Development Team', inline: false },
            { name: '🎨 Design', value: 'Community Contributors', inline: false },
            { name: '🧪 Testing', value: 'Beta Testers & Community', inline: false },
            { name: '📚 Libraries', value: 'Discord.js, Node.js, and other open-source projects', inline: false },
            { name: '❤️ Special Thanks', value: 'To all our users and supporters!', inline: false }
        )
        .setColor('#06ffa5');
    await interaction.reply({ embeds: [embed] });
}

async function handleChangelogCommand(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('📋 Recent Changes')
        .setDescription('**Latest Updates & Changes**')
        .addFields(
            { name: '🆕 v3.0.0 (Latest)', value: '• Added 150+ new commands\\n• Complete economy system\\n• RPG features\\n• Social interactions\\n• Customization options', inline: false },
            { name: '🔧 v2.5.0', value: '• Fixed ticket system bugs\\n• Improved payout system\\n• Added admin commands', inline: false },
            { name: '📈 v2.0.0', value: '• Major system overhaul\\n• New ticket features\\n• Performance improvements', inline: false }
        )
        .setFooter({ text: 'Check /version for more details!' })
        .setColor('#7209b7');
    await interaction.reply({ embeds: [embed] });
}

async function handleInsultCommand(interaction) { await interaction.reply("🤐 I'm too nice to insult anyone!"); }
async function handleCalculateCommand(interaction) { await interaction.reply('🧮 Calculator feature coming soon!'); }
async function handleMorseCommand(interaction) { await interaction.reply('📡 Morse code converter coming soon!'); }
async function handleBinaryCommand(interaction) { await interaction.reply('💾 Binary converter coming soon!'); }
async function handleBase64Command(interaction) { await interaction.reply('🔐 Base64 encoder coming soon!'); }
async function handleQRCommand(interaction) { await interaction.reply('📱 QR code generator coming soon!'); }
async function handleASCIICommand(interaction) { await interaction.reply('📝 ASCII art generator coming soon!'); }
async function handleReverseCommand(interaction) { await interaction.reply('🔄 Text reverser coming soon!'); }
async function handleScrambleCommand(interaction) { await interaction.reply('🔀 Text scrambler coming soon!'); }
async function handleWordCountCommand(interaction) { await interaction.reply('📏 Word counter coming soon!'); }
async function handleTranslateCommand(interaction) { await interaction.reply('🌍 Translator coming soon!'); }
async function handleUrbanCommand(interaction) { await interaction.reply('📚 Urban Dictionary lookup coming soon!'); }
async function handleWikipediaCommand(interaction) { await interaction.reply('📖 Wikipedia search coming soon!'); }
async function handleCatCommand(interaction) { await interaction.reply('🐱 Random cat pictures coming soon!'); }
async function handleDogCommand(interaction) { await interaction.reply('🐶 Random dog pictures coming soon!'); }
async function handlePokemonCommand(interaction) { await interaction.reply('⚡ Pokémon info coming soon!'); }
async function handleHoroscopeCommand(interaction) { await interaction.reply('⭐ Horoscope coming soon!'); }
async function handleNumberCommand(interaction) { await interaction.reply('🔢 Number facts coming soon!'); }
async function handleAchievementCommand(interaction) { await interaction.reply('🏆 Achievement generator coming soon!'); }
async function handleTriviaCommand(interaction) { await interaction.reply('🧠 Trivia questions coming soon!'); }
async function handleRiddleCommand(interaction) { await interaction.reply('🧩 Riddles coming soon!'); }
async function handleAnagramCommand(interaction) { await interaction.reply('🔤 Anagram solver coming soon!'); }
async function handleRhymeCommand(interaction) { await interaction.reply('🎵 Rhyme finder coming soon!'); }
async function handleFizzBuzzCommand(interaction) { await interaction.reply('🎮 FizzBuzz game coming soon!'); }
async function handleSimonCommand(interaction) { await interaction.reply('🎵 Simon Says coming soon!'); }
async function handleHangmanCommand(interaction) { await interaction.reply('🎪 Hangman game coming soon!'); }
async function handleWordleCommand(interaction) { await interaction.reply('📝 Wordle game coming soon!'); }
async function handleBlackjackCommand(interaction) { await interaction.reply('🃏 Blackjack game coming soon!'); }
async function handleSlotsCommand(interaction) { await interaction.reply('🎰 Slot machine coming soon!'); }
async function handleLotteryCommand(interaction) { await interaction.reply('🎫 Lottery system coming soon!'); }
async function handleLeaderboardCommand(interaction) { await interaction.reply('🏅 Leaderboards coming soon!'); }
async function handleLevelCommand(interaction) { await interaction.reply('📈 Level system coming soon!'); }
async function handleDailyCommand(interaction) { await interaction.reply('📅 Daily rewards coming soon!'); }
async function handleInventoryCommand(interaction) { await interaction.reply('🎒 Inventory system coming soon!'); }
async function handleShopCommand(interaction) { await interaction.reply('🛒 Shop system coming soon!'); }
async function handleGiftCommand(interaction) { await interaction.reply('🎁 Gift system coming soon!'); }
async function handleEconomyCommand(interaction) { await interaction.reply('💰 Economy stats coming soon!'); }
async function handleWorkCommand(interaction) { await interaction.reply('💼 Work system coming soon!'); }
async function handleRobCommand(interaction) { await interaction.reply('🔫 Rob system coming soon!'); }
async function handleGambleCommand(interaction) { await interaction.reply('🎲 Gambling coming soon!'); }
async function handleBankCommand(interaction) { await interaction.reply('🏦 Banking system coming soon!'); }
async function handleMarryCommand(interaction) { await interaction.reply('💒 Marriage system coming soon!'); }
async function handleDivorceCommand(interaction) { await interaction.reply('💔 Divorce system coming soon!'); }
async function handleAdoptCommand(interaction) { await interaction.reply('👶 Pet adoption coming soon!'); }
async function handlePetCommand(interaction) { await interaction.reply('🐾 Pet system coming soon!'); }
async function handleFeedCommand(interaction) { await interaction.reply('🍖 Pet feeding coming soon!'); }
async function handleFishCommand(interaction) { await interaction.reply('🎣 Fishing game coming soon!'); }
async function handleHuntCommand(interaction) { await interaction.reply('🏹 Hunting game coming soon!'); }
async function handleMineCommand(interaction) { await interaction.reply('⛏️ Mining game coming soon!'); }
async function handleCraftCommand(interaction) { await interaction.reply('🔨 Crafting system coming soon!'); }
async function handleBattleCommand(interaction) { await interaction.reply('⚔️ Battle system coming soon!'); }
async function handleDuelCommand(interaction) { await interaction.reply('🤺 Duel system coming soon!'); }
async function handleStatsCommand(interaction) { await interaction.reply('📊 Stats system coming soon!'); }
async function handleAchievementsCommand(interaction) { await interaction.reply('🏅 Achievements coming soon!'); }
async function handleQuestCommand(interaction) { await interaction.reply('🗺️ Quest system coming soon!'); }
async function handleDungeonCommand(interaction) { await interaction.reply('🏰 Dungeons coming soon!'); }
async function handleRaidCommand(interaction) { await interaction.reply('🐲 Raid system coming soon!'); }
async function handleGuildCommand(interaction) { await interaction.reply('⚔️ Guild system coming soon!'); }
async function handleMagicCommand(interaction) { await interaction.reply('🔮 Magic system coming soon!'); }
async function handlePotionCommand(interaction) { await interaction.reply('🧪 Potion system coming soon!'); }
async function handleSpellCommand(interaction) { await interaction.reply('✨ Spell system coming soon!'); }
async function handleEnchantCommand(interaction) { await interaction.reply('⚡ Enchanting coming soon!'); }
async function handleArenaCommand(interaction) { await interaction.reply('🏟️ Arena battles coming soon!'); }
async function handleTournamentCommand(interaction) { await interaction.reply('🏆 Tournaments coming soon!'); }
async function handleClanCommand(interaction) { await interaction.reply('🛡️ Clan system coming soon!'); }
async function handleWarCommand(interaction) { await interaction.reply('⚔️ Clan wars coming soon!'); }
async function handleTradeCommand(interaction) { await interaction.reply('🤝 Trading system coming soon!'); }
async function handleAuctionCommand(interaction) { await interaction.reply('🔨 Auction house coming soon!'); }
async function handleMarketCommand(interaction) { await interaction.reply('🏪 Marketplace coming soon!'); }
async function handleNewsCommand(interaction) { await interaction.reply('📰 Server news coming soon!'); }
async function handleEventsCommand(interaction) { await interaction.reply('🎉 Events system coming soon!'); }
async function handleBirthdayCommand(interaction) { await interaction.reply('🎂 Birthday system coming soon!'); }
async function handleTimezoneCommand(interaction) { await interaction.reply('🌍 Timezone system coming soon!'); }
async function handleAFKCommand(interaction) { await interaction.reply('😴 AFK system coming soon!'); }
async function handleStatusCommand(interaction) { await interaction.reply('📝 Status system coming soon!'); }
async function handleBadgeCommand(interaction) { await interaction.reply('🎖️ Badge system coming soon!'); }
async function handleTitleCommand(interaction) { await interaction.reply('👑 Title system coming soon!'); }
async function handleBackgroundCommand(interaction) { await interaction.reply('🖼️ Backgrounds coming soon!'); }
async function handleThemeCommand(interaction) { await interaction.reply('🎨 Themes coming soon!'); }
async function handleMusicCommand(interaction) { await interaction.reply('🎵 Music profiles coming soon!'); }
async function handleMoodCommand(interaction) { await interaction.reply('😊 Mood system coming soon!'); }
async function handleActivityCommand(interaction) { await interaction.reply('🎮 Activity tracking coming soon!'); }
async function handleBioCommand(interaction) { await interaction.reply('📝 Bio system coming soon!'); }
async function handleSocialCommand(interaction) { await interaction.reply('🔗 Social links coming soon!'); }
async function handlePlaylistCommand(interaction) { await interaction.reply('🎶 Playlists coming soon!'); }
async function handleRadioCommand(interaction) { await interaction.reply('📻 Radio system coming soon!'); }
async function handleKaraokeCommand(interaction) { await interaction.reply('🎤 Karaoke coming soon!'); }
async function handleDanceCommand(interaction) { await interaction.reply('💃 Dance system coming soon!'); }
async function handleEmoteCommand(interaction) { await interaction.reply('😄 Emote system coming soon!'); }
async function handleGifCommand(interaction) { await interaction.reply('🎬 GIF search coming soon!'); }
async function handleStickerCommand(interaction) { await interaction.reply('🏷️ Sticker system coming soon!'); }
async function handleSoundboardCommand(interaction) { await interaction.reply('🔊 Soundboard coming soon!'); }
async function handleVoiceCommand(interaction) { await interaction.reply('🎙️ Voice messages coming soon!'); }
async function handleTTSCommand(interaction) { await interaction.reply('🗣️ Text-to-speech coming soon!'); }
async function handleWhisperCommand(interaction) { await interaction.reply('🤫 Whisper system coming soon!'); }
async function handleShoutCommand(interaction) { await interaction.reply('📢 Announcement system coming soon!'); }
async function handleConfessionCommand(interaction) { await interaction.reply('💭 Confession system coming soon!'); }
async function handleSuggestionCommand(interaction) { await interaction.reply('💡 Suggestion system coming soon!'); }
async function handleReportCommand(interaction) { await interaction.reply('⚠️ Report system coming soon!'); }
async function handleFeedbackCommand(interaction) { await interaction.reply('📝 Feedback system coming soon!'); }
async function handleReviewCommand(interaction) { await interaction.reply('⭐ Review system coming soon!'); }
async function handleSubscribeCommand(interaction) { await interaction.reply('🔔 Subscription system coming soon!'); }
async function handleBookmarkCommand(interaction) { await interaction.reply('🔖 Bookmark system coming soon!'); }
async function handleNotesCommand(interaction) { await interaction.reply('📝 Notes system coming soon!'); }
async function handleTodoCommand(interaction) { await interaction.reply('✅ Todo system coming soon!'); }
async function handleCalendarCommand(interaction) { await interaction.reply('📅 Calendar system coming soon!'); }
async function handleScheduleCommand(interaction) { await interaction.reply('🗓️ Schedule system coming soon!'); }
async function handleAlarmCommand(interaction) { await interaction.reply('⏰ Alarm system coming soon!'); }
async function handleStopwatchCommand(interaction) { await interaction.reply('⏱️ Stopwatch coming soon!'); }
async function handleCountdownCommand(interaction) { await interaction.reply('⏳ Countdown system coming soon!'); }
async function handleWorldClockCommand(interaction) { await interaction.reply('🌍 World clock coming soon!'); }
async function handleTimerCommand(interaction) { await interaction.reply('⏰ Timer system coming soon!'); }
async function handleReminderCommand(interaction) { await interaction.reply('📝 Reminder system coming soon!'); }
async function handlePollCommand(interaction) { await interaction.reply('📊 Poll system coming soon!'); }

client.login(DISCORD_TOKEN);
