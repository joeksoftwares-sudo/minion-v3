// Discord Ticket System Bot Logic (Requires Node.js Environment)
// This file has been updated to use environment variables for secure deployment and includes Firestore logic.

const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, SlashCommandBuilder } = require('discord.js');
const admin = require('firebase-admin');

// --- FIREBASE INITIALIZATION ---
// Railway requires the Service Account Key JSON to be passed as a single base64-encoded environment variable.
let db;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        // Decode the base64 string back into the JSON object
        const serviceAccountJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8');
        const serviceAccount = JSON.parse(serviceAccountJson);
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin SDK initialized successfully.");
        db = admin.firestore();

    } catch (error) {
        console.error("FIREBASE ERROR: Failed to parse or initialize Firebase Admin SDK. The bot will not persist data.", error.message);
        // The bot will continue running without persistence, but core features will fail.
    }
} else {
    // This warning should appear if the environment variable is missing
    console.error("FIREBASE ERROR: FIREBASE_SERVICE_ACCOUNT environment variable is not set. The bot will not persist data.");
}


// --- BOT CONFIGURATION (Loaded from environment variables) ---
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;         
const HIGH_STAFF_ROLE_ID = process.env.HIGH_STAFF_ROLE_ID; 
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;       

const TICKET_CATEGORIES = {
    'media_apply': { name: 'Apply for Media', categoryId: process.env.MEDIA_CATEGORY_ID },
    'report_exploit': { name: 'Report Exploiters', categoryId: process.env.EXPLOIT_CATEGORY_ID },
    'general_support': { name: 'General Support', categoryId: process.env.GENERAL_SUPPORT_CATEGORY_ID }
};

const ROBOT_VALUE_PER_TICKET = 15;
const PAYOUT_MIN = 300;
const PAYOUT_MAX = 700;
const AUTO_UNCLAIM_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

// Collection names for Firestore
const TICKET_COLLECTION = 'tickets';
const STATS_COLLECTION = 'staff_stats';

// Map to hold active unclaim timers (key: channelId, value: setTimeout object)
const activeTimers = new Map();

// --- MEDIA APPLICATION QUESTIONS ---
// This array defines the questions for the media application flow.
const MEDIA_QUESTIONS = [
    { step: 1, prompt: "What is your full YouTube channel link?", key: "youtubeLink" },
    { step: 2, prompt: "How many subscribers does your main platform currently have?", key: "subscribers" },
    { step: 3, prompt: "How many average views do your last 5 videos/streams receive?", key: "avgViews" },
    { step: 4, prompt: "Do you have any prior history with our community (bans, warnings, etc.)? (Please answer Yes/No)", key: "priorHistory" },
];


// --- PERSISTENCE FUNCTIONS (Using Firestore) ---

/**
 * Retrieves staff statistics from Firestore.
 * @param {string} userId - The staff member's Discord ID.
 * @returns {Promise<object>} Staff stats object.
 */
async function getStaffStats(userId) {
    try {
        // Fallback for non-initialized DB to prevent crashes
        if (!db) return { completedTickets: 0, robux: 0 };
        
        const docRef = db.collection(STATS_COLLECTION).doc(userId);
        const doc = await docRef.get();
        if (doc.exists) {
            return doc.data();
        }
        return { completedTickets: 0, robux: 0 }; // Default stats
    } catch (e) {
        console.error(`Error fetching staff stats for ${userId}:`, e);
        return { completedTickets: 0, robux: 0 }; 
    }
}

/**
 * Updates staff statistics in Firestore.
 * @param {string} userId - The staff member's Discord ID.
 * @param {object} data - Data to update/merge.
 */
async function updateStaffStats(userId, data) {
    try {
        if (!db) return;
        const docRef = db.collection(STATS_COLLECTION).doc(userId);
        await docRef.set(data, { merge: true });
    } catch (e) {
        console.error(`Error updating staff stats for ${userId}:`, e);
    }
}

/**
 * Retrieves ticket data from Firestore.
 * @param {string} channelId - The Discord channel ID.
 * @returns {Promise<object | null>} Ticket data object or null.
 */
async function getTicket(channelId) {
    try {
        if (!db) return null;
        const docRef = db.collection(TICKET_COLLECTION).doc(channelId);
        const doc = await docRef.get();
        return doc.exists ? doc.data() : null;
    } catch (e) {
        console.error(`Error fetching ticket ${channelId}:`, e);
        return null; 
    }
}

/**
 * Sets or updates ticket data in Firestore.
 * @param {string} channelId - The Discord channel ID.
 * @param {object} data - Data to set/update.
 */
async function setTicket(channelId, data) {
    try {
        if (!db) return;
        const docRef = db.collection(TICKET_COLLECTION).doc(channelId);
        await docRef.set(data, { merge: true });
    } catch (e) {
        console.error(`Error setting ticket ${channelId}:`, e);
    }
}

/**
 * Deletes ticket data from Firestore.
 * @param {string} channelId - The Discord channel ID.
 */
async function deleteTicket(channelId) {
    try {
        if (!db) return;
        await db.collection(TICKET_COLLECTION).doc(channelId).delete();
    } catch (e) {
        console.error(`Error deleting ticket ${channelId}:`, e);
    }
}

// --- END PERSISTENCE FUNCTIONS ---


const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

client.on('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);

    // Register slash commands globally (or per-guild for faster testing)
    const commands = [
        new SlashCommandBuilder().setName('ticket-panel').setDescription('Sends the aesthetic ticket creation panel.'),
        new SlashCommandBuilder().setName('check-robux').setDescription('Checks your current accumulated Robux earnings.'),
        new SlashCommandBuilder().setName('payout').setDescription('Initiates a Robux payout request.'),
        new SlashCommandBuilder().setName('close').setDescription('Closes the current ticket, preventing user replies.'),
        new SlashCommandBuilder().setName('delete').setDescription('Deletes a closed ticket and saves a transcript.')
    ].map(command => command.toJSON());

    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        await guild.commands.set(commands);
        console.log('Slash commands registered.');
    } else {
        console.warn('Guild not found. Commands registered globally (may take time).');
        await client.application.commands.set(commands);
    }
});

// --- HELPER FUNCTIONS ---

/**
 * Starts or resets the 20-minute auto-unclaim timer.
 * @param {string} channelId - The ID of the ticket channel.
 */
function startUnclaimTimer(channelId) {
    // Clear any existing timer
    if (activeTimers.has(channelId)) {
        clearTimeout(activeTimers.get(channelId));
        activeTimers.delete(channelId);
    }

    const timer = setTimeout(async () => {
        const channel = client.channels.cache.get(channelId);
        const ticketData = await getTicket(channelId);

        if (channel && ticketData && ticketData.claimedBy) {
            await unclaimTicket(channel, ticketData);
            channel.send({ content: 
                `⚠️ **Auto-Unclaimed:** The staff member <@${ticketData.claimedBy}> did not reply within 20 minutes of the user's last message. The ticket is now open for any support member to claim.` 
            });
        }
        activeTimers.delete(channelId);
    }, AUTO_UNCLAIM_TIMEOUT_MS);

    activeTimers.set(channelId, timer);
}

/**
 * Applies or removes the claim lock on the channel permissions.
 * (Implementation remains the same, relying on Discord API)
 */
async function applyClaimLock(channel, claimedBy) {
    const guild = channel.guild;
    const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);

    const overwrites = channel.permissionOverwrites.cache.get(STAFF_ROLE_ID);
    if (!overwrites) return; 

    // Skip permission edits if the bot is in control of the ticket
    if (claimedBy === 'BOT_INTERACTION') return;

    if (claimedBy) {
        // 1. Deny SendMessages for the general staff role
        await channel.permissionOverwrites.edit(staffRole, { SendMessages: false });
        // 2. Allow SendMessages for the claimed user
        const claimedMember = await guild.members.fetch(claimedBy).catch(() => null);
        if (claimedMember) {
            await channel.permissionOverwrites.edit(claimedMember.user.id, { ViewChannel: true, SendMessages: true });
        }
    } else {
        // Unclaim: Allow SendMessages for the general staff role
        await channel.permissionOverwrites.edit(staffRole, { SendMessages: true });
        // Clean up the individual member overwrite if it exists
        const oldTicketData = await getTicket(channel.id);
        if (oldTicketData?.claimedBy && oldTicketData.claimedBy !== 'BOT_INTERACTION') {
             // Remove the specific override for the previously claimed staff member
             await channel.permissionOverwrites.delete(oldTicketData.claimedBy).catch(() => {}); // Catch error if overwrite already gone
        }
    }
}

/**
 * Handles the unclaiming process.
 */
async function unclaimTicket(channel, ticketData) {
    await applyClaimLock(channel, null); // Remove claim lock
    await setTicket(channel.id, { ...ticketData, claimedBy: null, lastUserReplyAt: null });
    if (activeTimers.has(channel.id)) {
        clearTimeout(activeTimers.get(channel.id));
        activeTimers.delete(channel.id);
    }
}

/**
 * Creates an HTML transcript of the channel content. (Implementation remains the same)
 */
async function createTranscript(channel) {
    // This is a simplified, basic HTML structure for demonstration.
    const messages = await channel.messages.fetch({ limit: 100 });
    const sortedMessages = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    let transcriptContent = sortedMessages.map(m => 
        `<div class="message-container">
            <span class="timestamp">[${m.createdAt.toLocaleString()}]</span>
            <span class="author" style="color: ${m.member?.displayHexColor || '#fff'};">${m.author.tag}:</span>
            <span class="content">${m.content.replace(/\n/g, '<br>')}</span>
        </div>`
    ).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticket Transcript: #${channel.name}</title>
    <style>
        body { font-family: sans-serif; background-color: #36393f; color: #dcddde; padding: 20px; }
        .transcript-header { background-color: #2f3136; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .message-container { margin-bottom: 10px; border-left: 2px solid #5865f2; padding-left: 10px; }
        .timestamp { color: #72767d; font-size: 0.8em; margin-right: 5px; }
        .author { font-weight: bold; margin-right: 5px; }
        .content { white-space: pre-wrap; }
    </style>
</head>
<body>
    <div class="transcript-header">
        <h1>Transcript for #${channel.name}</h1>
        <p>Created on: ${new Date().toLocaleString()}</p>
    </div>
    <div class="transcript-body">
        ${transcriptContent}
    </div>
</body>
</html>
    `;
}


/**
 * Handles the multi-step questionnaire for media applications.
 */
async function handleQuestionnaire(message, ticketData) {
    const channel = message.channel;
    const currentStep = ticketData.step || 0;
    const answeredQuestion = MEDIA_QUESTIONS.find(q => q.step === currentStep);

    if (!answeredQuestion) return; 

    // 1. Save the answer to the current question
    const newQna = ticketData.qna || {};
    newQna[answeredQuestion.key] = message.content;
    
    // 2. Determine the next step
    const nextStep = currentStep + 1;
    const nextQuestion = MEDIA_QUESTIONS.find(q => q.step === nextStep);
    const totalQuestions = MEDIA_QUESTIONS.length;

    if (nextQuestion) {
        // Still more questions: Update state and ask the next question
        await setTicket(channel.id, { step: nextStep, qna: newQna });
        
        await channel.send(`✅ Answer received.

**Question ${nextStep}/${totalQuestions}: ${nextQuestion.prompt}**`);
    } else {
        // Questionnaire complete: Finalize ticket and unclaim from BOT
        
        // Final state update
        await setTicket(channel.id, { 
            claimedBy: null, // Unclaim for staff to take over
            step: 999, // Mark as complete
            qna: newQna, // Save final answer
            isClosed: false // Ensure it's not marked closed yet
        });
        
        const controlsRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('🔒'),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary).setEmoji('🛑'),
                new ButtonBuilder().setCustomId('delete_ticket').setLabel('Delete (Log)').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
                new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Primary).setEmoji('🔓'),
            );
            
        // Compile a summary of answers
        const summaryEmbed = new EmbedBuilder()
            .setTitle('Media Application Summary')
            .setDescription('**Application complete!** Staff can now claim this ticket for review.')
            .addFields(
                { name: 'Channel Link', value: newQna.youtubeLink || 'N/A', inline: false },
                { name: 'Subscribers', value: newQna.subscribers || 'N/A', inline: true },
                { name: 'Avg. Views (Last 5)', value: newQna.avgViews || 'N/A', inline: true },
                { name: 'Prior History?', value: newQna.priorHistory || 'N/A', inline: false },
                { name: '\u200B', value: '\u200B', inline: false },
            )
            .setColor('#2ECC71'); 

        // Initial message (now with management buttons)
        await channel.send({ 
            content: `🎉 **Questionnaire Complete!** The ticket is now open for <@&${STAFF_ROLE_ID}> to claim and review.`, 
            embeds: [summaryEmbed], 
            components: [controlsRow] 
        });
    }
}


// --- SLASH COMMAND HANDLER ---
client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        const { commandName } = interaction;

        if (commandName === 'ticket-panel') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'You need administrator permissions to use this command.', ephemeral: true });
            }
            await sendTicketPanel(interaction);
        } else if (commandName === 'check-robux') {
            await checkRobuxCommand(interaction);
        } else if (commandName === 'payout') {
            await payoutCommand(interaction);
        } else if (commandName === 'close') {
            await closeCommand(interaction);
        } else if (commandName === 'delete') {
            await deleteCommand(interaction);
        }
    }
});

// --- COMMAND IMPLEMENTATIONS ---

async function sendTicketPanel(interaction) {
    const panelEmbed = new EmbedBuilder()
        .setTitle('🎫 Official Support Ticket System')
        .setDescription('Select one of the options below to open a ticket. Please be specific with your request to help us assist you faster.')
        .setColor('#5865F2')
        .setFooter({ text: 'Powered by the Support Team' });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('media_apply').setLabel('1. Apply for Media').setStyle(ButtonStyle.Success).setEmoji('📸'),
            new ButtonBuilder().setCustomId('report_exploit').setLabel('2. Report Exploiters').setStyle(ButtonStyle.Danger).setEmoji('🚨'),
            new ButtonBuilder().setCustomId('general_support').setLabel('3. General Support').setStyle(ButtonStyle.Primary).setEmoji('❓'),
        );

    await interaction.channel.send({ embeds: [panelEmbed], components: [row] });
    await interaction.reply({ content: 'Ticket panel sent!', ephemeral: true });
}

async function checkRobuxCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.user.id;
    // Use Firestore function
    const stats = await getStaffStats(userId);

    const embed = new EmbedBuilder()
        .setTitle('💰 Robux Earning Status')
        .setDescription(`Hello, <@${userId}>! Here are your current earnings:`)
        .addFields(
            { name: 'Completed Tickets', value: `${stats.completedTickets}`, inline: true },
            { name: 'Total Robux Earned', value: `${stats.robux} R$`, inline: true },
            { name: '\u200B', value: '\u200B', inline: false },
            { name: 'Payout Range', value: `Min: ${PAYOUT_MIN} R$ | Max: ${PAYOUT_MAX} R$`, inline: false }
        )
        .setColor('#FEE75C');

    await interaction.editReply({ embeds: [embed] });
}

async function payoutCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const userId = interaction.user.id;
    // Use Firestore function
    const stats = await getStaffStats(userId);

    if (stats.robux < PAYOUT_MIN) {
        return interaction.editReply({ content: `You need at least ${PAYOUT_MIN} R$ to request a payout. You currently have ${stats.robux} R$.`, ephemeral: true });
    }

    if (stats.robux > PAYOUT_MAX) {
        return interaction.editReply({ content: `Your current earnings (${stats.robux} R$) exceed the maximum payout of ${PAYOUT_MAX} R$. Please contact a high staff member directly.`, ephemeral: true });
    }

    // This initiates the payout flow: asking for the gamepass link.
    const filter = m => m.author.id === userId;
    interaction.editReply({ content: 'Please paste the Roblox gamepass link for your payout now. This request will expire in 60 seconds.' });

    // Await for the gamepass link
    try {
        const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const gamepassLink = collected.first().content;
        
        // Validation (simple check)
        if (!gamepassLink.startsWith('https://www.roblox.com/game-pass/')) {
            return interaction.followUp({ content: 'Invalid link. Please ensure it is a valid Roblox gamepass URL. Try the `/payout` command again.', ephemeral: true });
        }

        const highStaffChannel = client.channels.cache.get(LOG_CHANNEL_ID); 
        if (!highStaffChannel) {
             console.error('High staff/log channel not found.');
             return interaction.followUp({ content: 'There was an error processing the request (Log channel missing).', ephemeral: true });
        }

        // Send request to higher staff
        const payoutEmbed = new EmbedBuilder()
            .setTitle('🚨 NEW ROBux PAYOUT REQUEST')
            .setDescription(`A staff member is requesting a payout.`)
            .addFields(
                { name: 'Requesting Staff', value: `<@${userId}>`, inline: true },
                { name: 'Robux Amount', value: `${stats.robux} R$`, inline: true },
                { name: 'Roblox Gamepass Link', value: gamepassLink, inline: false }
            )
            .setColor('#23E25B');
            
        // The role mention ensures the high staff is notified
        await highStaffChannel.send({ content: `<@&${HIGH_STAFF_ROLE_ID}>`, embeds: [payoutEmbed] });
        
        // IMPORTANT: Reset the staff's Robux count to 0 in Firestore after successful request logging
        await updateStaffStats(userId, { robux: 0, completedTickets: 0, lastPayout: Date.now() }); 

        interaction.followUp({ content: '✅ Payout request submitted! A high-ranking staff member will review and process the payout via the gamepass link shortly. Your earnings have been logged and reset for processing.', ephemeral: true });

    } catch (e) {
        interaction.followUp({ content: 'Payout request timed out or cancelled.', ephemeral: true });
    }
}

/**
 * Handles closing a ticket via the /close slash command.
 */
async function closeCommand(interaction) {
    const { channel, member } = interaction;
    const userId = interaction.user.id;

    // 1. Staff check
    if (!member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You must be a staff member to use this command.', ephemeral: true });
    }

    // 2. Ticket data check
    const ticketData = await getTicket(channel.id);
    if (!ticketData) {
        return interaction.reply({ content: 'This channel is not an active ticket channel in the database.', ephemeral: true });
    }
    
    // 3. Prevent interaction while bot is running questionnaire
    if (ticketData.claimedBy === 'BOT_INTERACTION') {
        return interaction.reply({ content: 'The bot is currently running the media application questionnaire. Please wait for the process to complete.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // 4. Close the ticket (lock user out)
    await channel.permissionOverwrites.edit(ticketData.userId, { SendMessages: false });
    
    // 5. Set isClosed state in Firestore (FIX for delete issue)
    await setTicket(channel.id, { isClosed: true });

    await channel.send(`🛑 **Closed:** The ticket has been closed by <@${userId}>. Only staff can now delete the ticket. The original user (<@${ticketData.userId}>) can no longer reply.`);
    await interaction.editReply('Ticket closed successfully.');
}

/**
 * Handles deleting a ticket via the /delete slash command.
 */
async function deleteCommand(interaction) {
    const { channel, member } = interaction;
    const userId = interaction.user.id;

    // 1. Staff check
    if (!member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You must be a staff member to use this command.', ephemeral: true });
    }

    // 2. Ticket data check
    let ticketData = await getTicket(channel.id);
    if (!ticketData) {
        return interaction.reply({ content: 'This channel is not an active ticket channel in the database.', ephemeral: true });
    }
    
    // 3. Check for closed state using Firestore data (FIX for delete issue)
    if (!ticketData.isClosed) {
         return interaction.reply({ content: 'Please close the ticket first using the "Close" button or `/close` command to prevent user replies during deletion.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    
    // 4. Generate Transcript
    await interaction.editReply('Generating transcript and deleting ticket...');
    const htmlTranscript = await createTranscript(channel);
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    
    if (logChannel) {
        const transcriptBuffer = Buffer.from(htmlTranscript, 'utf-8');
        
        const transcriptEmbed = new EmbedBuilder()
            .setTitle('Ticket Transcript Log')
            .setDescription(`Ticket #${channel.name} deleted by <@${userId}>.`)
            .addFields(
                { name: 'Ticket User', value: `<@${ticketData.userId}>`, inline: true },
                { name: 'Category', value: TICKET_CATEGORIES[ticketData.type]?.name || 'Unknown', inline: true }
            )
            .setColor('#2C2F33');

        const linkPlaceholder = 'https://transcript-storage.example.com/' + channel.id; 
        const linkRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setURL(linkPlaceholder).setLabel('Direct Link (Example)').setStyle(ButtonStyle.Link),
            );
        
        await logChannel.send({ 
            embeds: [transcriptEmbed], 
            files: [{ attachment: transcriptBuffer, name: `${channel.name}_transcript.html` }],
            components: [linkRow]
        });
    }

    // 5. Robux/Stats Update (Only if claimed)
    if (ticketData.claimedBy && ticketData.claimedBy !== 'BOT_INTERACTION' && db) {
        // Increment completedTickets and Robux in one atomic operation
        await db.collection(STATS_COLLECTION).doc(ticketData.claimedBy).set({
            completedTickets: admin.firestore.FieldValue.increment(1),
            robux: admin.firestore.FieldValue.increment(ROBOT_VALUE_PER_TICKET)
        }, { merge: true });
    }
    
    // 6. Clean up and delete
    await deleteTicket(channel.id);
    if (activeTimers.has(channel.id)) {
        clearTimeout(activeTimers.get(channel.id));
        activeTimers.delete(activeTimers.get(channel.id));
    }
    
    // Final reply for ephemeral interaction
    await interaction.editReply('Ticket deleted and transcript logged.');
    
    // Actual channel deletion
    setTimeout(() => channel.delete().catch(console.error), 1000); 
}


// --- BUTTON INTERACTION HANDLER ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;

    if (TICKET_CATEGORIES[customId]) {
        // This handles the ticket creation buttons on the main panel
        await handleTicketCreation(interaction, customId);
    } else if (customId === 'claim_ticket' || customId === 'close_ticket' || customId === 'delete_ticket' || customId === 'unclaim_ticket') {
        // This handles the management buttons inside the ticket channel
        await handleTicketManagement(interaction);
    }
});

async function handleTicketCreation(interaction, typeId) {
    await interaction.deferReply({ ephemeral: true });

    const ticketType = TICKET_CATEGORIES[typeId];
    const user = interaction.user;
    const guild = interaction.guild;
    const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);
    const categoryChannel = guild.channels.cache.get(ticketType.categoryId);

    if (!staffRole || !categoryChannel) {
        return interaction.editReply('Error: Staff role or category channel not found. Bot configuration is incomplete.');
    }

    // Check for existing open ticket by this user using a Firestore query
    if (db) {
        const allTicketsSnapshot = await db.collection(TICKET_COLLECTION).where('userId', '==', user.id).get();
        if (!allTicketsSnapshot.empty) {
            const existingTicketDoc = allTicketsSnapshot.docs[0];
            const existingTicketChannel = guild.channels.cache.get(existingTicketDoc.id);
            if (existingTicketChannel) {
                return interaction.editReply({ content: `You already have an open ticket at ${existingTicketChannel}. Please close that one first.`, ephemeral: true });
            } else {
                // Clean up stale data if channel is gone but doc exists
                await deleteTicket(existingTicketDoc.id);
            }
        }
    }


    // 1. Create the channel
    const channel = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        type: ChannelType.GuildText,
        parent: categoryChannel.id,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, // Deny @everyone
            { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // Allow user
            { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // Allow staff
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // Allow bot
        ],
    });

    // 2. Store ticket data in database
    const isMediaTicket = typeId === 'media_apply';
    let initialClaimedBy = null;
    let initialStep = 0;
    
    // If it's a media ticket, set bot interaction state for the questionnaire flow
    if (isMediaTicket) {
        initialClaimedBy = 'BOT_INTERACTION'; 
        initialStep = 1; 
    }

    await setTicket(channel.id, {
        userId: user.id,
        type: typeId,
        claimedBy: initialClaimedBy, // Set to 'BOT_INTERACTION' if media ticket
        createdAt: Date.now(),
        lastUserReplyAt: null,
        step: initialStep, // Start at step 1 for media
        qna: {}, // To store answers
        isClosed: false // Initial state: not closed
    });

    // 3. Update interaction response as requested
    await interaction.editReply({ content: `✅ **Ticket created!** Redirecting you to the channel: ${channel}` });

    if (isMediaTicket) {
        // Media flow: Ask first question immediately
        const firstQuestion = MEDIA_QUESTIONS.find(q => q.step === 1);
        await channel.send(`👋 Welcome, <@${user.id}>! This is a **Media Application**. To proceed, please answer the following questions.

**Question 1/${MEDIA_QUESTIONS.length}: ${firstQuestion.prompt}**`);
        return; // Exit here, wait for questionnaire response, don't send management buttons yet.
    }

    // --- STANDARD TICKET FLOW (If not media) ---
    const controlsRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('🔒'),
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary).setEmoji('🛑'),
            new ButtonBuilder().setCustomId('delete_ticket').setLabel('Delete (Log)').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Primary).setEmoji('🔓'),
        );

    const initialEmbed = new EmbedBuilder()
        .setTitle(`${ticketType.name} Ticket`)
        .setDescription(`Welcome, <@${user.id}>! A staff member will be with you shortly. Please explain your request in detail.`)
        .addFields({ name: 'Type', value: ticketType.name, inline: true })
        .setColor('#5865F2');

    // Send initial message with controls for standard tickets
    await channel.send({ 
        content: `👋 Hey @everyone! <@&${STAFF_ROLE_ID}> A new ticket has been opened by <@${user.id}>.`, 
        embeds: [initialEmbed], 
        components: [controlsRow] 
    });
}

async function handleTicketManagement(interaction) {
    const { customId, channel, user, member } = interaction;

    // Only allow staff to use these buttons
    if (!member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You are not a staff member and cannot manage tickets.', ephemeral: true });
    }

    // Get ticket status from DB (Firestore)
    const ticketData = await getTicket(channel.id);
    if (!ticketData) {
        return interaction.reply({ content: 'This channel is not an active ticket channel in the database.', ephemeral: true });
    }

    // Prevent staff interaction while the bot is running the questionnaire
    if (ticketData.claimedBy === 'BOT_INTERACTION') {
        return interaction.reply({ content: 'The bot is currently running the media application questionnaire. Please wait for the process to complete before claiming.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    if (customId === 'claim_ticket') {
        if (ticketData.claimedBy) {
            return interaction.editReply(`This ticket is already claimed by <@${ticketData.claimedBy}>.`);
        }
        
        // Claim the ticket
        await applyClaimLock(channel, user.id);
        await setTicket(channel.id, { ...ticketData, claimedBy: user.id });
        
        await channel.send(`🔒 **Claimed:** This ticket has been claimed by <@${user.id}>. Other staff members can no longer reply.`);
        await interaction.editReply('You have successfully claimed the ticket.');

    } else if (customId === 'unclaim_ticket') {
        if (!ticketData.claimedBy || ticketData.claimedBy !== user.id) {
            return interaction.editReply(`You cannot unclaim this ticket as it is currently claimed by <@${ticketData.claimedBy || 'no one'}>, or you are not the claimant.`);
        }
        
        // Unclaim the ticket
        await unclaimTicket(channel, ticketData);
        await channel.send(`🔓 **Unclaimed:** The ticket has been unclaimed by <@${user.id}> and is now open for any staff member to reply.`);
        await interaction.editReply('You have successfully unclaimed the ticket.');

    } else if (customId === 'close_ticket') {
        // Close the ticket (lock user out)
        await channel.permissionOverwrites.edit(ticketData.userId, { SendMessages: false });
        // Set isClosed state in Firestore (FIX: for reliable deletion check)
        await setTicket(channel.id, { isClosed: true });
        
        await channel.send(`🛑 **Closed:** The ticket has been closed by <@${user.id}>. Only staff can now delete the ticket. The original user (<@${ticketData.userId}>) can no longer reply.`);
        await interaction.editReply('Ticket closed.');
        
    } else if (customId === 'delete_ticket') {
        // 1. Ensure the ticket is closed before deletion/transcription
        // The check now relies on the Firestore state, which is set by the 'close_ticket' action.
        if (!ticketData.isClosed) {
             return interaction.editReply('Please close the ticket first using the "Close" button to prevent user replies during deletion.');
        }

        // 2. Generate Transcript
        await interaction.editReply('Generating transcript and deleting ticket...');
        const htmlTranscript = await createTranscript(channel);
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        
        if (logChannel) {
            const transcriptBuffer = Buffer.from(htmlTranscript, 'utf-8');
            
            const transcriptEmbed = new EmbedBuilder()
                .setTitle('Ticket Transcript Log')
                .setDescription(`Ticket #${channel.name} deleted by <@${user.id}>.`)
                .addFields(
                    { name: 'Ticket User', value: `<@${ticketData.userId}>`, inline: true },
                    { name: 'Category', value: TICKET_CATEGORIES[ticketData.type]?.name || 'Unknown', inline: true }
                )
                .setColor('#2C2F33');

            const linkPlaceholder = 'https://transcript-storage.example.com/' + channel.id; 
            const linkRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setURL(linkPlaceholder).setLabel('Direct Link (Example)').setStyle(ButtonStyle.Link),
                );
            
            await logChannel.send({ 
                embeds: [transcriptEmbed], 
                files: [{ attachment: transcriptBuffer, name: `${channel.name}_transcript.html` }],
                components: [linkRow]
            });
        }

        // 3. Robux/Stats Update (Only if claimed)
        if (ticketData.claimedBy && db) {
            // Increment completedTickets and Robux in one atomic operation
            await db.collection(STATS_COLLECTION).doc(ticketData.claimedBy).set({
                completedTickets: admin.firestore.FieldValue.increment(1),
                robux: admin.firestore.FieldValue.increment(ROBOT_VALUE_PER_TICKET)
            }, { merge: true });
        }
        
        // 4. Clean up and delete
        await deleteTicket(channel.id);
        if (activeTimers.has(channel.id)) {
            clearTimeout(activeTimers.get(channel.id));
            activeTimers.delete(activeTimers.get(channel.id));
        }
        
        setTimeout(() => channel.delete().catch(console.error), 1000); 
    }
}


// --- MESSAGE MONITORING FOR AUTO-UNCLAIM / QUESTIONNAIRE ---
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const channel = message.channel;
    // Use Firestore function
    const ticketData = await getTicket(channel.id);
    if (!ticketData) return; // Not a ticket channel

    // 1. QUESTIONNAIRE LOGIC
    // If the bot is controlling the ticket and the message is from the user
    if (ticketData.claimedBy === 'BOT_INTERACTION' && message.author.id === ticketData.userId) {
        await handleQuestionnaire(message, ticketData);
        return; // Stop here, do not run unclaim timer logic
    }
    
    // 2. AUTO-UNCLAIM LOGIC (Only runs if a staff member has claimed the ticket)
    if (!ticketData.claimedBy || ticketData.claimedBy === 'BOT_INTERACTION') return; // Not a claimed ticket (or bot is handling it)

    const isStaff = message.member.roles.cache.has(STAFF_ROLE_ID);
    const isClaimant = message.author.id === ticketData.claimedBy;

    if (!isStaff && message.author.id === ticketData.userId) {
        // User replied to a claimed ticket. Reset the staff's 20-minute timer.
        ticketData.lastUserReplyAt = Date.now();
        await setTicket(channel.id, ticketData);
        startUnclaimTimer(channel.id);
        console.log(`Timer reset for ticket ${channel.id}. Staff: ${ticketData.claimedBy}`);
    } else if (isClaimant) {
        // Claiming staff replied. If a timer was running (meaning user replied previously), clear it.
        if (activeTimers.has(channel.id)) {
            clearTimeout(activeTimers.get(channel.id));
            activeTimers.delete(activeTimers.get(channel.id));
            await channel.send('✅ Staff reply received. Auto-unclaim timer cleared.');
        }
    }
});

// Check if the token is available before logging in
if (!TOKEN) {
    console.error("DISCORD_TOKEN environment variable is not set. The bot cannot start.");
} else {
    client.login(TOKEN).catch(err => console.error("Failed to log in:", err));
}
