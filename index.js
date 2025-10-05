// Discord Ticket System Bot Logic (Requires Node.js Environment)
// This file has been updated to use Supabase (PostgreSQL + Storage) for persistence.

const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, SlashCommandBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid'); // Needed for generating unique transcript file names

// --- SUPABASE INITIALIZATION ---
// Supabase requires two environment variables: URL and ANON_KEY
let supabase;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET_NAME = 'transcripts'; // Hardcoded bucket name for simplicity

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("Supabase client initialized successfully.");
    } catch (error) {
        console.error("SUPABASE ERROR: Failed to initialize Supabase client.", error.message);
    }
} else {
    console.error("SUPABASE ERROR: SUPABASE_URL or SUPABASE_ANON_KEY environment variable is not set. The bot will not persist data.");
}

// NOTE: Unlike Firebase, Supabase uses tables for collections, which we must define.
// We will assume the following tables exist in your Supabase DB:
const TICKET_TABLE = 'tickets';
const STATS_TABLE = 'staff_stats';


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


// --- PERSISTENCE FUNCTIONS (Using Supabase - PostgreSQL) ---

/**
 * Retrieves staff statistics from Supabase. Supabase uses primary key ('id' which is the userId).
 * If no record exists, it returns a default.
 * @param {string} userId - The staff member's Discord ID.
 * @returns {Promise<object>} Staff stats object.
 */
async function getStaffStats(userId) {
    try {
        if (!supabase) return { completedTickets: 0, robux: 0 };
        
        const { data, error } = await supabase
            .from(STATS_TABLE)
            .select('*')
            .eq('id', userId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 means "not found" which is fine
            throw error;
        }

        return data || { id: userId, completedTickets: 0, robux: 0 }; 
    } catch (e) {
        console.error(`Error fetching staff stats for ${userId}:`, e.message);
        return { id: userId, completedTickets: 0, robux: 0 }; 
    }
}

/**
 * Updates staff statistics in Supabase. Uses upsert for "set" functionality.
 * @param {string} userId - The staff member's Discord ID.
 * @param {object} data - Data to update/merge.
 */
async function updateStaffStats(userId, data) {
    try {
        if (!supabase) return;
        
        // Supabase requires merging the ID into the data object for upsert
        const updateData = { id: userId, ...data };

        const { error } = await supabase
            .from(STATS_TABLE)
            .upsert(updateData, { onConflict: 'id' });

        if (error) throw error;

    } catch (e) {
        console.error(`Error updating staff stats for ${userId}:`, e.message);
    }
}

/**
 * Retrieves ticket data from Supabase. Primary key is the channelId.
 * @param {string} channelId - The Discord channel ID.
 * @returns {Promise<object | null>} Ticket data object or null.
 */
async function getTicket(channelId) {
    try {
        if (!supabase) return null;
        
        const { data, error } = await supabase
            .from(TICKET_TABLE)
            .select('*')
            .eq('id', channelId)
            .single();
            
        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        // If data is null, the ticket doesn't exist
        return data; 
    } catch (e) {
        console.error(`Error fetching ticket ${channelId}:`, e.message);
        return null; 
    }
}

/**
 * Sets or updates ticket data in Supabase. Uses upsert for "set" functionality.
 * @param {string} channelId - The Discord channel ID.
 * @param {object} data - Data to set/update.
 */
async function setTicket(channelId, data) {
    try {
        if (!supabase) return;
        
        // Supabase requires merging the ID into the data object for upsert
        const updateData = { id: channelId, ...data };
        
        const { error } = await supabase
            .from(TICKET_TABLE)
            .upsert(updateData, { onConflict: 'id' });

        if (error) throw error;

    } catch (e) {
        console.error(`Error setting ticket ${channelId}:`, e.message);
    }
}

/**
 * Deletes ticket data from Supabase.
 * @param {string} channelId - The Discord channel ID.
 */
async function deleteTicket(channelId) {
    try {
        if (!supabase) return;
        
        const { error } = await supabase
            .from(TICKET_TABLE)
            .delete()
            .eq('id', channelId);
            
        if (error) throw error;

    } catch (e) {
        console.error(`Error deleting ticket ${channelId}:`, e.message);
    }
}

// --- SUPABASE STORAGE FUNCTIONS ---

/**
 * Uploads the HTML transcript to Supabase Storage and returns the public URL.
 * @param {string} channelName - The name of the Discord channel (used for file path).
 * @param {string} htmlContent - The HTML content to upload.
 * @returns {Promise<string | null>} The public download URL or null on failure.
 */
async function uploadTranscriptToStorage(channelName, htmlContent) {
    if (!supabase) {
        console.error("Supabase client is not initialized. Cannot upload transcript.");
        return null;
    }

    // Use a unique file name to avoid clashes
    const fileName = `${channelName}_transcript_${uuidv4()}.html`;
    const path = `${fileName}`; // Saved directly under the bucket (e.g., transcripts/file.html)
    const transcriptBuffer = Buffer.from(htmlContent, 'utf-8');

    try {
        // Upload the file as a buffer
        const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET_NAME)
            .upload(path, transcriptBuffer, {
                contentType: 'text/html',
                upsert: false // We use a unique ID, so no upsert needed
            });

        if (uploadError) throw uploadError;

        // Get the public URL for the file
        const { data: publicUrlData } = supabase.storage
            .from(STORAGE_BUCKET_NAME)
            .getPublicUrl(path);

        if (!publicUrlData || !publicUrlData.publicUrl) {
            console.error("Failed to retrieve public URL after successful upload.");
            return null;
        }

        return publicUrlData.publicUrl; 

    } catch (e) {
        console.error(`Error uploading transcript ${fileName}:`, e.message);
        return null;
    }
}

// --- END PERSISTENCE & STORAGE FUNCTIONS ---


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

// --- DYNAMIC CONTROL ROW HELPER (Same as previous version) ---

/**
 * Generates the dynamic action row for ticket controls, swapping buttons based on state.
 * @param {object} ticketData - The current ticket data from Supabase.
 * @returns {ActionRowBuilder}
 */
function getTicketControlRow(ticketData) {
    const isClaimed = !!ticketData.claimedBy;
    const isClosed = ticketData.isClosed;

    let claimButton;
    if (isClaimed) {
        // Swaps: Show Unclaim button if claimed
        claimButton = new ButtonBuilder()
            .setCustomId('unclaim_ticket')
            .setLabel('Unclaim')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔓');
    } else {
        // Swaps: Show Claim button if unclaimed
        claimButton = new ButtonBuilder()
            .setCustomId('claim_ticket')
            .setLabel('Claim')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔒');
    }

    let deleteCloseButton;
    if (isClosed) {
        // Swaps: Show Delete button if closed
        deleteCloseButton = new ButtonBuilder()
            .setCustomId('delete_ticket')
            .setLabel('Delete (Log)')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️');
    } else {
        // Swaps: Show Close button if open
        deleteCloseButton = new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🛑');
    }
    
    const row = new ActionRowBuilder().addComponents(claimButton, deleteCloseButton);
    return row;
}

/**
 * Finds the control message and updates its components based on current ticket state.
 * @param {Channel} channel - The Discord channel object.
 * @param {object} ticketData - The current ticket data from Supabase.
 */
async function updateControlMessage(channel, ticketData) {
    if (!ticketData.controlMessageId) return;

    // Get the latest ticket data in case the action handler hasn't committed it yet
    const latestTicketData = await getTicket(channel.id);
    if (!latestTicketData) return;

    const newRow = getTicketControlRow(latestTicketData);
    
    try {
        const message = await channel.messages.fetch(latestTicketData.controlMessageId);
        // Retain any existing embeds from the original message (like the initial welcome embed or media summary)
        await message.edit({ embeds: message.embeds, components: [newRow] });
    } catch (e) {
        console.error("Failed to edit control message, it may have been deleted:", e.message);
        // If the message is gone, remove the ID from the database
        const updateData = { controlMessageId: null };
        await setTicket(channel.id, updateData);
    }
}


// --- HELPER FUNCTIONS (Some remain the same) ---

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
            await unclaimTicket(channel, ticketData); // This will update the state and controls
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
 * Handles the unclaiming process (updates state and controls).
 */
async function unclaimTicket(channel, ticketData) {
    await applyClaimLock(channel, null); // Remove claim lock
    const updatedData = { claimedBy: null, lastUserReplyAt: null };
    await setTicket(channel.id, updatedData); // Only update the fields needed
    
    if (activeTimers.has(channel.id)) {
        clearTimeout(activeTimers.get(channel.id));
        activeTimers.delete(channel.id);
    }
    
    // Update the control message to show the 'Claim' button
    await updateControlMessage(channel, { id: channel.id, ...updatedData });
}

/**
 * Creates an HTML transcript of the channel content that mimics Discord's appearance.
 * (Same as previous version, ensures visual consistency)
 * @param {Channel} channel - The Discord channel object.
 * @returns {Promise<string>} The HTML content of the transcript.
 */
async function createTranscript(channel) {
    // Fetch all messages in the channel (up to 100)
    const messages = await channel.messages.fetch({ limit: 100 });
    const sortedMessages = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    let transcriptContent = sortedMessages.map(m => {
        const username = m.author.username;
        const discriminator = m.author.discriminator; 
        const tag = `${username}${discriminator !== '0' ? '#' + discriminator : ''}`;
        const avatarUrl = m.author.displayAvatarURL({ extension: 'png', size: 64 });
        const memberColor = m.member?.displayHexColor || '#ffffff';
        const timestamp = m.createdAt.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric', year: 'numeric', month: 'numeric', day: 'numeric', hour12: true });
        
        // Basic content sanitization for HTML display
        let content = m.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');

        return `
            <div class="message-container">
                <img class="avatar" src="${avatarUrl}" alt="${tag} avatar">
                <div class="message-content">
                    <span class="header">
                        <span class="author-name" style="color: ${memberColor};">${tag}</span>
                        <span class="timestamp">${timestamp}</span>
                    </span>
                    <span class="text-content">${content}</span>
                </div>
            </div>`;
    }).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ticket Transcript: #${channel.name}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        body { 
            font-family: 'Inter', sans-serif; 
            background-color: #36393f; /* Discord Dark Theme Background */
            color: #dcddde; /* Discord Default Text Color */
            padding: 20px; 
            margin: 0;
            display: flex;
            justify-content: center;
        }
        .transcript-wrapper {
            width: 100%;
            max-width: 960px; /* Discord Max Width for chat area */
        }
        .transcript-header { 
            background-color: #2f3136; /* Discord Channel Header Color */
            padding: 20px; 
            border-radius: 8px 8px 0 0; 
            margin-bottom: 5px; 
            border-bottom: 1px solid #202225;
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .transcript-header h1 {
            font-size: 1.5em;
            color: #fff;
            margin: 0;
        }
        .transcript-header p {
            margin: 5px 0 0 0;
            color: #b9bbbe;
        }
        .transcript-body {
            background-color: #36393f; 
            padding: 10px 0;
        }
        .message-container { 
            display: flex;
            padding: 5px 20px;
            margin-bottom: 2px;
            align-items: flex-start;
            transition: background-color 0.1s;
        }
        .message-container:hover {
            background-color: #32353b; /* Hover effect */
        }
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin-right: 15px;
            flex-shrink: 0;
            object-fit: cover;
            margin-top: 2px;
        }
        .message-content {
            display: flex;
            flex-direction: column;
            line-height: 1.4;
            flex-grow: 1;
        }
        .header {
            margin-bottom: 2px;
            display: flex;
            align-items: center;
        }
        .author-name { 
            font-weight: 500; 
            font-size: 1em;
            margin-right: 8px; 
        }
        .timestamp { 
            color: #72767d; 
            font-size: 0.75em; 
            font-weight: 400;
        }
        .text-content { 
            word-wrap: break-word;
            word-break: break-all;
            color: #dcddde;
        }
    </style>
</head>
<body>
    <div class="transcript-wrapper">
        <div class="transcript-header">
            <h1>Ticket Transcript: #${channel.name}</h1>
            <p>User: ${sortedMessages[0]?.author.tag || 'N/A'}</p>
            <p>Created on: ${new Date().toLocaleString()}</p>
        </div>
        <div class="transcript-body">
            ${transcriptContent}
        </div>
    </div>
</body>
</html>
    `;
}


/**
 * Handles the multi-step questionnaire for media applications.
 * (Same as previous version)
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
        let updatedData = { 
            claimedBy: null, // Unclaim for staff to take over
            step: 999, // Mark as complete
            qna: newQna, // Save final answer
            isClosed: false // Ensure it's not marked closed yet
        };
        
        const controlsRow = getTicketControlRow({ id: channel.id, ...updatedData }); // Get dynamic controls
            
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
        const controlMessage = await channel.send({ 
            content: `🎉 **Questionnaire Complete!** The ticket is now open for <@&${STAFF_ROLE_ID}> to claim and review.`, 
            embeds: [summaryEmbed], 
            components: [controlsRow] 
        });
        
        // Save the control message ID for future edits
        updatedData.controlMessageId = controlMessage.id;
        await setTicket(channel.id, updatedData);
    }
}


// --- SLASH COMMAND HANDLER (Mostly the same) ---
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
            await deleteCommand(interaction); // Updated to use Supabase Storage
        }
    }
});

// --- COMMAND IMPLEMENTATIONS (Only deleteCommand updated) ---

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
    // Use Supabase function
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
    // Use Supabase function
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
        
        // IMPORTANT: Reset the staff's Robux count to 0 in Supabase after successful request logging
        await updateStaffStats(userId, { robux: 0, completedTickets: 0, lastPayout: Date.now() }); 

        interaction.followUp({ content: '✅ Payout request submitted! A high-ranking staff member will review and process the payout via the gamepass link shortly. Your earnings have been logged and reset for processing.', ephemeral: true });

    } catch (e) {
        interaction.followUp({ content: 'Payout request timed out or cancelled.', ephemeral: true });
    }
}

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
    
    // 5. Set isClosed state in Supabase
    const updatedData = { isClosed: true };
    await setTicket(channel.id, updatedData);

    await channel.send(`🛑 **Closed:** The ticket has been closed by <@${userId}>. Only staff can now delete the ticket. The original user (<@${ticketData.userId}>) can no longer reply.`);
    await interaction.editReply('Ticket closed successfully.');
    
    // 6. Update control message buttons
    await updateControlMessage(channel, { id: channel.id, ...updatedData });
}

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
    
    // 3. Check for closed state using Supabase data
    if (!ticketData.isClosed) {
         return interaction.reply({ content: 'Please close the ticket first using the "Close" button or `/close` command to prevent user replies during deletion.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    
    // 4. Generate Transcript and Upload
    await interaction.editReply('Generating transcript, uploading, and deleting ticket...');
    const htmlTranscript = await createTranscript(channel);
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    
    let transcriptUrl = null;
    let attachmentFile = null;

    if (logChannel) {
        // --- NEW: UPLOAD TO SUPABASE STORAGE ---
        transcriptUrl = await uploadTranscriptToStorage(channel.name, htmlTranscript);

        // Always create a local buffer attachment as a safety backup
        attachmentFile = {
            attachment: Buffer.from(htmlTranscript, 'utf-8'), 
            name: `${channel.name}_transcript.html` 
        };
        // ----------------------------------------

        const linkUrl = transcriptUrl || 'https://storage-upload-failed.example.com/';
        const linkLabel = transcriptUrl ? 'View Transcript (Direct Link)' : 'View Transcript (Local File Only)';

        const transcriptEmbed = new EmbedBuilder()
            .setTitle('Ticket Transcript Log')
            .setDescription(`Ticket #${channel.name} deleted by <@${userId}>.`)
            .addFields(
                { name: 'Ticket User', value: `<@${ticketData.userId}>`, inline: true },
                { name: 'Category', value: TICKET_CATEGORIES[ticketData.type]?.name || 'Unknown', inline: true }
            )
            .setColor('#2C2F33');

        const linkRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setURL(linkUrl).setLabel(linkLabel).setStyle(ButtonStyle.Link),
            );
        
        await logChannel.send({ 
            embeds: [transcriptEmbed], 
            files: attachmentFile ? [attachmentFile] : [],
            components: [linkRow]
        });
    }

    // 5. Robux/Stats Update (Only if claimed)
    if (ticketData.claimedBy && ticketData.claimedBy !== 'BOT_INTERACTION' && supabase) {
        // We need to fetch the current stats, increment them manually, and then save them back.
        // SQL update is more complex, so we'll use a transaction style read-modify-write.
        
        const currentStats = await getStaffStats(ticketData.claimedBy);
        
        const newCompletedTickets = currentStats.completedTickets + 1;
        const newRobux = currentStats.robux + ROBOT_VALUE_PER_TICKET;

        await updateStaffStats(ticketData.claimedBy, {
            completedTickets: newCompletedTickets,
            robux: newRobux
        });
    }
    
    // 6. Clean up and delete
    await deleteTicket(channel.id);
    if (activeTimers.has(channel.id)) {
        clearTimeout(activeTimers.get(channel.id));
        activeTimers.delete(activeTimers.get(channel.id));
    }
    
    // Final reply for ephemeral interaction
    await interaction.editReply('Ticket deleted, transcript uploaded, and log sent.');
    
    // Actual channel deletion
    setTimeout(() => channel.delete().catch(console.error), 1000); 
}


// --- BUTTON INTERACTION HANDLER (Only delete_ticket updated) ---
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

    // Check for existing open ticket by this user using a Supabase query
    if (supabase) {
        const { data: existingTickets, error } = await supabase
            .from(TICKET_TABLE)
            .select('id')
            .eq('userId', user.id)
            .limit(1);

        if (error) {
            console.error('Supabase query error:', error);
            // Continue even on error to attempt ticket creation, but log the error
        } else if (existingTickets && existingTickets.length > 0) {
            const existingTicketChannel = guild.channels.cache.get(existingTickets[0].id);
            if (existingTicketChannel) {
                return interaction.editReply({ content: `You already have an open ticket at ${existingTicketChannel}. Please close that one first.`, ephemeral: true });
            } else {
                // Clean up stale data if channel is gone but doc exists
                await deleteTicket(existingTickets[0].id);
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

    // 2. Define initial ticket data
    const isMediaTicket = typeId === 'media_apply';
    let initialClaimedBy = null;
    let initialStep = 0;
    
    if (isMediaTicket) {
        initialClaimedBy = 'BOT_INTERACTION'; 
        initialStep = 1; 
    }
    
    let ticketData = {
        id: channel.id, // Supabase primary key must be here
        userId: user.id,
        type: typeId,
        claimedBy: initialClaimedBy, 
        createdAt: Date.now(),
        lastUserReplyAt: null,
        step: initialStep, 
        qna: {}, 
        isClosed: false,
        controlMessageId: null // Will be updated after message is sent
    };

    // 3. Update interaction response as requested
    await interaction.editReply({ content: `✅ **Ticket created!** Redirecting you to the channel: ${channel}` });

    if (isMediaTicket) {
        // Media flow: Ask first question immediately
        await setTicket(channel.id, ticketData); // Save initial state before message
        const firstQuestion = MEDIA_QUESTIONS.find(q => q.step === 1);
        await channel.send(`👋 Welcome, <@${user.id}>! This is a **Media Application**. To proceed, please answer the following questions.

**Question 1/${MEDIA_QUESTIONS.length}: ${firstQuestion.prompt}**`);
        return; 
    }

    // --- STANDARD TICKET FLOW (If not media) ---
    const controlsRow = getTicketControlRow(ticketData);

    const initialEmbed = new EmbedBuilder()
        .setTitle(`${ticketType.name} Ticket`)
        .setDescription(`Welcome, <@${user.id}>! A staff member will be with you shortly. Please explain your request in detail.`)
        .addFields({ name: 'Type', value: ticketType.name, inline: true })
        .setColor('#5865F2');

    // Send initial message with controls for standard tickets
    const controlMessage = await channel.send({ 
        content: `👋 Hey @everyone! <@&${STAFF_ROLE_ID}> A new ticket has been opened by <@${user.id}>.`, 
        embeds: [initialEmbed], 
        components: [controlsRow] 
    });
    
    // 4. Save the control message ID
    ticketData.controlMessageId = controlMessage.id;
    await setTicket(channel.id, ticketData);
}

async function handleTicketManagement(interaction) {
    const { customId, channel, user, member } = interaction;

    // Only allow staff to use these buttons
    if (!member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You are not a staff member and cannot manage tickets.', ephemeral: true });
    }

    // Get ticket status from DB (Supabase)
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
        const updatedData = { claimedBy: user.id };
        await setTicket(channel.id, updatedData);
        
        await channel.send(`🔒 **Claimed:** This ticket has been claimed by <@${user.id}>. Other staff members can no longer reply.`);
        await interaction.editReply('You have successfully claimed the ticket.');
        
        // Update control message to show 'Unclaim' button
        await updateControlMessage(channel, { id: channel.id, ...updatedData });

    } else if (customId === 'unclaim_ticket') {
        if (!ticketData.claimedBy) {
            return interaction.editReply('This ticket is not currently claimed.');
        }
        // Allow any staff member to unclaim to prevent deadlocks
        
        // Unclaim the ticket (unclaimTicket handles DB update and control message update)
        await unclaimTicket(channel, ticketData);
        await channel.send(`🔓 **Unclaimed:** The ticket has been unclaimed by <@${user.id}> and is now open for any staff member to reply.`);
        await interaction.editReply('You have successfully unclaimed the ticket.');


    } else if (customId === 'close_ticket') {
        // Close the ticket (lock user out)
        await channel.permissionOverwrites.edit(ticketData.userId, { SendMessages: false });
        
        // Set isClosed state in Supabase 
        const updatedData = { isClosed: true };
        await setTicket(channel.id, updatedData);
        
        await channel.send(`🛑 **Closed:** The ticket has been closed by <@${user.id}>. Only staff can now delete the ticket. The original user (<@${ticketData.userId}>) can no longer reply.`);
        await interaction.editReply('Ticket closed.');
        
        // Update control message to show 'Delete' button
        await updateControlMessage(channel, { id: channel.id, ...updatedData });
        
    } else if (customId === 'delete_ticket') {
        // 1. Ensure the ticket is closed before deletion/transcription
        if (!ticketData.isClosed) {
             return interaction.editReply('Please close the ticket first using the "Close" button to prevent user replies during deletion.');
        }

        // 2. Generate Transcript and Upload
        await interaction.editReply('Generating transcript, uploading, and deleting ticket...');
        const htmlTranscript = await createTranscript(channel);
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        
        let transcriptUrl = null;
        let attachmentFile = null;

        if (logChannel) {
            // --- UPLOAD TO SUPABASE STORAGE ---
            transcriptUrl = await uploadTranscriptToStorage(channel.name, htmlTranscript);

            // Always create a local buffer attachment as a safety backup
            attachmentFile = {
                attachment: Buffer.from(htmlTranscript, 'utf-8'), 
                name: `${channel.name}_transcript.html` 
            };
            // ----------------------------------------
            
            const linkUrl = transcriptUrl || 'https://storage-upload-failed.example.com/';
            const linkLabel = transcriptUrl ? 'View Transcript (Direct Link)' : 'View Transcript (Local File Only)';

            const transcriptEmbed = new EmbedBuilder()
                .setTitle('Ticket Transcript Log')
                .setDescription(`Ticket #${channel.name} deleted by <@${user.id}>.`)
                .addFields(
                    { name: 'Ticket User', value: `<@${ticketData.userId}>`, inline: true },
                    { name: 'Category', value: TICKET_CATEGORIES[ticketData.type]?.name || 'Unknown', inline: true }
                )
                .setColor('#2C2F33');

            const linkRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setURL(linkUrl).setLabel(linkLabel).setStyle(ButtonStyle.Link),
                );
            
            await logChannel.send({ 
                embeds: [transcriptEmbed], 
                files: attachmentFile ? [attachmentFile] : [],
                components: [linkRow]
            });
        }

        // 3. Robux/Stats Update (Only if claimed)
        if (ticketData.claimedBy && ticketData.claimedBy !== 'BOT_INTERACTION' && supabase) {
            // Fetch current stats to manually increment
            const currentStats = await getStaffStats(ticketData.claimedBy);
            
            const newCompletedTickets = currentStats.completedTickets + 1;
            const newRobux = currentStats.robux + ROBOT_VALUE_PER_TICKET;

            await updateStaffStats(ticketData.claimedBy, {
                completedTickets: newCompletedTickets,
                robux: newRobux
            });
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


// --- MESSAGE MONITORING FOR AUTO-UNCLAIM / QUESTIONNAIRE (Same as previous version) ---
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const channel = message.channel;
    // Use Supabase function
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
        await setTicket(channel.id, { lastUserReplyAt: ticketData.lastUserReplyAt });
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

// FUCKING CHECKS THE FUCKING TOKEN NIGGA
if (!TOKEN) {
    console.error("DISCORD_TOKEN environment variable is not set. The bot cannot start.");
} else {
    client.login(TOKEN).catch(err => console.error("Failed to log in:", err));
}
