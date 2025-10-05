// Discord Ticket System Bot Logic (Requires Node.js Environment)
// This file has been updated to use Supabase (PostgreSQL + Storage) for persistence.

// --- UPDATED IMPORTS FOR MODALS ---
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Collection, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionsBitField, 
    ChannelType, 
    SlashCommandBuilder,
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle // Required for Modal text inputs
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid'); 

// --- SUPABASE INITIALIZATION ---
// Supabase requires two environment variables: URL and ANON_KEY
let supabase;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET_NAME = 'transcripts'; 

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
    'general_support': { name: 'General Support', categoryId: processs.env.GENERAL_SUPPORT_CATEGORY_ID }
};

const ROBOT_VALUE_PER_TICKET = 15;
const PAYOUT_MIN = 300;
const PAYOUT_MAX = 700;
const AUTO_UNCLAIM_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

// Map to hold active unclaim timers (key: channelId, value: setTimeout object)
const activeTimers = new Map();

// --- MEDIA APPLICATION MODAL FIELDS ---
// Defines the fields used in the Discord Modal pop-up form.
const MEDIA_MODAL_FIELDS = [
    { 
        label: "Full Channel Link (YouTube/Twitch)", 
        customId: "youtubeLink", 
        style: TextInputStyle.Short, 
        placeholder: "e.g., https://youtube.com/@username", 
        required: true,
        minLength: 10
    },
    { 
        label: "Subscriber/Follower Count (Main Platform)", 
        customId: "subscribers", 
        style: TextInputStyle.Short, 
        placeholder: "Enter number only (e.g., 5000)", 
        required: true,
        maxLength: 20
    },
    { 
        label: "Avg. Views on Last 5 Videos/Streams", 
        customId: "avgViews", 
        style: TextInputStyle.Short, 
        placeholder: "Enter average number (e.g., 500)", 
        required: true,
        maxLength: 20
    },
    { 
        label: "Do you have prior history (bans/warnings)?", 
        customId: "priorHistory", 
        style: TextInputStyle.Paragraph, // Use Paragraph for more space
        placeholder: "Answer YES/NO and provide details if YES. (Max 500 chars)", 
        required: true,
        maxLength: 500
    }
];

// --- PERSISTENCE FUNCTIONS (Supabase) ---

async function getStaffStats(userId) {
    try {
        if (!supabase) return { completedTickets: 0, robux: 0 };
        
        const { data, error } = await supabase
            .from(STATS_TABLE)
            .select('*')
            .eq('id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        return data || { id: userId, completedTickets: 0, robux: 0 }; 
    } catch (e) {
        console.error(`Error fetching staff stats for ${userId}:`, e.message);
        return { id: userId, completedTickets: 0, robux: 0 }; 
    }
}

async function updateStaffStats(userId, data) {
    try {
        if (!supabase) return;
        
        const updateData = { id: userId, ...data };

        const { error } = await supabase
            .from(STATS_TABLE)
            .upsert(updateData, { onConflict: 'id' });

        if (error) throw error;

    } catch (e) {
        console.error(`Error updating staff stats for ${userId}:`, e.message);
    }
}

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

        return data; 
    } catch (e) {
        // This is the error that the user is encountering when it's not found: 'PGRST116' (no rows found)
        console.error(`Error fetching ticket ${channelId}:`, e.message);
        return null; 
    }
}

async function setTicket(channelId, data) {
    try {
        if (!supabase) return;
        
        const updateData = { id: channelId, ...data };
        
        // This upsert operation is critical for saving the ticket data
        const { error } = await supabase
            .from(TICKET_TABLE)
            .upsert(updateData, { onConflict: 'id' });

        if (error) throw error;

    } catch (e) {
        // If an insertion fails (e.g., due to schema mismatch), this console.error should be triggered.
        // The fix addresses the most likely cause: timestamp format mismatch.
        console.error(`Error setting ticket ${channelId}:`, e.message);
    }
}

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

async function uploadTranscriptToStorage(channelName, htmlContent) {
    if (!supabase) {
        console.error("Supabase client is not initialized. Cannot upload transcript.");
        return null;
    }
    const fileName = `${channelName}_transcript_${uuidv4()}.html`;
    const path = `${fileName}`; 
    const transcriptBuffer = Buffer.from(htmlContent, 'utf-8');

    try {
        const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET_NAME)
            .upload(path, transcriptBuffer, {
                contentType: 'text/html',
                upsert: false
            });

        if (uploadError) throw uploadError;

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

    await new Promise(resolve => setTimeout(resolve, 3000)); 

    // Define the slash commands
    const commands = [
        new SlashCommandBuilder().setName('ticket-panel').setDescription('Sends the aesthetic ticket creation panel.'),
        new SlashCommandBuilder().setName('check-robux').setDescription('Checks your current accumulated Robux earnings.'),
        new SlashCommandBuilder().setName('payout').setDescription('Initiates a Robux payout request.'),
        new SlashCommandBuilder().setName('close').setDescription('Closes the current ticket, preventing user replies.'),
        new SlashCommandBuilder().setName('delete').setDescription('Deletes a closed ticket and saves a transcript.')
    ].map(command => command.toJSON());

    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        try {
            await guild.commands.set(commands); 
            console.log(`Slash commands registered successfully to guild ${GUILD_ID}.`);
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    } else {
        console.error(`Guild ID ${GUILD_ID} not found in cache. Commands not registered. Check GUILD_ID variable.`);
    }
});

// --- DYNAMIC CONTROL ROW HELPER ---

function getTicketControlRow(ticketData) {
    const isClaimed = !!ticketData.claimedBy;
    const isClosed = ticketData.isClosed;

    let claimButton;
    if (isClaimed) {
        claimButton = new ButtonBuilder()
            .setCustomId('unclaim_ticket')
            .setLabel('Unclaim')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔓');
    } else {
        claimButton = new ButtonBuilder()
            .setCustomId('claim_ticket')
            .setLabel('Claim')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔒');
    }

    let deleteCloseButton;
    if (isClosed) {
        deleteCloseButton = new ButtonBuilder()
            .setCustomId('delete_ticket')
            .setLabel('Delete (Log)')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️');
    } else {
        deleteCloseButton = new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🛑');
    }
    
    const row = new ActionRowBuilder().addComponents(claimButton, deleteCloseButton);
    return row;
}

async function updateControlMessage(channel, ticketData) {
    if (!ticketData.controlMessageId) return;

    const latestTicketData = await getTicket(channel.id);
    if (!latestTicketData) return;

    const newRow = getTicketControlRow(latestTicketData);
    
    try {
        const message = await channel.messages.fetch(latestTicketData.controlMessageId);
        // Retain existing embeds (important for media application summary)
        await message.edit({ embeds: message.embeds, components: [newRow] });
    } catch (e) {
        console.error("Failed to edit control message, it may have been deleted:", e.message);
        const updateData = { controlMessageId: null };
        await setTicket(channel.id, updateData);
    }
}


// --- HELPER FUNCTIONS ---

function startUnclaimTimer(channelId) {
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

async function applyClaimLock(channel, claimedBy) {
    const guild = channel.guild;
    const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);

    const overwrites = channel.permissionOverwrites.cache.get(STAFF_ROLE_ID);
    if (!overwrites) return; 

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
        if (oldTicketData?.claimedBy) {
             await channel.permissionOverwrites.delete(oldTicketData.claimedBy).catch(() => {});
        }
    }
}

async function unclaimTicket(channel, ticketData) {
    await applyClaimLock(channel, null); 
    const updatedData = { claimedBy: null, lastUserReplyAt: null };
    await setTicket(channel.id, updatedData);
    
    if (activeTimers.has(channel.id)) {
        clearTimeout(activeTimers.get(channel.id));
        activeTimers.delete(channel.id);
    }
    
    await updateControlMessage(channel, { id: channel.id, ...updatedData });
}

// Transcript generation (no change)
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
            background-color: #36393f; 
            color: #dcddde; 
            padding: 20px; 
            margin: 0;
            display: flex;
            justify-content: center;
        }
        .transcript-wrapper {
            width: 100%;
            max-width: 960px; 
        }
        .transcript-header { 
            background-color: #2f3136; 
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
            background-color: #32353b; 
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

// --- SLASH COMMAND HANDLER (No major changes here) ---
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

// --- COMMAND IMPLEMENTATIONS (No major changes) ---
// ... (sendTicketPanel, checkRobuxCommand, payoutCommand remain the same) ...

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
    const stats = await getStaffStats(userId);

    if (stats.robux < PAYOUT_MIN) {
        return interaction.editReply({ content: `You need at least ${PAYOUT_MIN} R$ to request a payout. You currently have ${stats.robux} R$.`, ephemeral: true });
    }

    if (stats.robux > PAYOUT_MAX) {
        return interaction.editReply({ content: `Your current earnings (${stats.robux} R$) exceed the maximum payout of ${PAYOUT_MAX} R$. Please contact a high staff member directly.`, ephemeral: true });
    }

    const filter = m => m.author.id === userId;
    interaction.editReply({ content: 'Please paste the Roblox gamepass link for your payout now. This request will expire in 60 seconds.' });

    try {
        const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
        const gamepassLink = collected.first().content;
        
        if (!gamepassLink.startsWith('https://www.roblox.com/game-pass/')) {
            return interaction.followUp({ content: 'Invalid link. Please ensure it is a valid Roblox gamepass URL. Try the `/payout` command again.', ephemeral: true });
        }

        const highStaffChannel = client.channels.cache.get(LOG_CHANNEL_ID); 
        if (!highStaffChannel) {
             console.error('High staff/log channel not found.');
             return interaction.followUp({ content: 'There was an error processing the request (Log channel missing).', ephemeral: true });
        }

        const payoutEmbed = new EmbedBuilder()
            .setTitle('🚨 NEW ROBux PAYOUT REQUEST')
            .setDescription(`A staff member is requesting a payout.`)
            .addFields(
                { name: 'Requesting Staff', value: `<@${userId}>`, inline: true },
                { name: 'Robux Amount', value: `${stats.robux} R$`, inline: true },
                { name: 'Roblox Gamepass Link', value: gamepassLink, inline: false }
            )
            .setColor('#23E25B');
            
        await highStaffChannel.send({ content: `<@&${HIGH_STAFF_ROLE_ID}>`, embeds: [payoutEmbed] });
        
        await updateStaffStats(userId, { robux: 0, completedTickets: 0, lastPayout: new Date().toISOString() }); // Convert to ISO string

        interaction.followUp({ content: '✅ Payout request submitted! A high-ranking staff member will review and process the payout via the gamepass link shortly. Your earnings have been logged and reset for processing.', ephemeral: true });

    } catch (e) {
        interaction.followUp({ content: 'Payout request timed out or cancelled.', ephemeral: true });
    }
}

async function closeCommand(interaction) {
    const { channel, member } = interaction;
    const userId = interaction.user.id;

    if (!member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You must be a staff member to use this command.', ephemeral: true });
    }

    const ticketData = await getTicket(channel.id);
    if (!ticketData) {
        // FIX: Removed the specific database error message
        return interaction.reply({ content: '❌ This command failed because this channel is not a valid ticket.', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });

    await channel.permissionOverwrites.edit(ticketData.userId, { SendMessages: false });
    
    const updatedData = { isClosed: true };
    await setTicket(channel.id, updatedData);

    await channel.send(`🛑 **Closed:** The ticket has been closed by <@${userId}>. Only staff can now delete the ticket. The original user (<@${ticketData.userId}>) can no longer reply.`);
    await interaction.editReply('Ticket closed successfully.');
    
    await updateControlMessage(channel, { id: channel.id, ...updatedData });
}

async function deleteCommand(interaction) {
    const { channel, member } = interaction;
    const userId = interaction.user.id;

    if (!member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You must be a staff member to use this command.', ephemeral: true });
    }

    let ticketData = await getTicket(channel.id);
    if (!ticketData) {
        // FIX: Removed the specific database error message
        return interaction.reply({ content: '❌ This command failed because this channel is not a valid ticket.', ephemeral: true });
    }
    
    if (!ticketData.isClosed) {
         return interaction.reply({ content: 'Please close the ticket first using the "Close" button or `/close` command to prevent user replies during deletion.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    
    await interaction.editReply('Generating transcript, uploading, and deleting ticket...');
    const htmlTranscript = await createTranscript(channel);
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    
    let transcriptUrl = null;
    let attachmentFile = null;

    if (logChannel) {
        transcriptUrl = await uploadTranscriptToStorage(channel.name, htmlTranscript);

        attachmentFile = {
            attachment: Buffer.from(htmlTranscript, 'utf-8'), 
            name: `${channel.name}_transcript.html` 
        };

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

    if (ticketData.claimedBy && supabase) {
        const currentStats = await getStaffStats(ticketData.claimedBy);
        
        const newCompletedTickets = currentStats.completedTickets + 1;
        const newRobux = currentStats.robux + ROBOT_VALUE_PER_TICKET;

        await updateStaffStats(ticketData.claimedBy, {
            completedTickets: newCompletedTickets,
            robux: newRobux
        });
    }
    
    await deleteTicket(channel.id);
    if (activeTimers.has(channel.id)) {
        clearTimeout(activeTimers.get(channel.id));
        activeTimers.delete(channel.id); 
    }
    
    await interaction.editReply('Ticket deleted, transcript uploaded, and log sent.');
    
    setTimeout(() => channel.delete().catch(console.error), 1000); 
}


// --- MAIN INTERACTION HANDLER: BUTTONS AND MODALS ---
client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const customId = interaction.customId;
        if (TICKET_CATEGORIES[customId]) {
            // This handles the ticket creation buttons on the main panel
            await handleTicketCreation(interaction, customId);
        } else if (customId === 'claim_ticket' || customId === 'close_ticket' || customId === 'delete_ticket' || customId === 'unclaim_ticket') {
            // This handles the management buttons inside the ticket channel
            await handleTicketManagement(interaction);
        }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'mediaApplicationModal') {
            // NEW: Handle the completed media application form
            await handleMediaModalSubmit(interaction);
        }
    }
});


/**
 * NEW FUNCTION: Creates and displays the Media Application Modal.
 */
async function showMediaModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('mediaApplicationModal')
        .setTitle('Media Application Form');

    const components = MEDIA_MODAL_FIELDS.map(field => {
        const input = new TextInputBuilder()
            .setCustomId(field.customId)
            .setLabel(field.label)
            .setStyle(field.style)
            .setRequired(field.required)
            .setPlaceholder(field.placeholder)
            .setMaxLength(field.maxLength || 4000)
            .setMinLength(field.minLength || 1);

        // Discord Modals require components to be wrapped in an ActionRowBuilder
        return new ActionRowBuilder().addComponents(input);
    });

    modal.addComponents(...components);
    // Show the modal to the user, pausing the interaction flow
    await interaction.showModal(modal);
}

/**
 * NEW FUNCTION: Processes the submitted modal data and creates the media ticket channel.
 */
async function handleMediaModalSubmit(interaction) {
    // Acknowledge the modal submission immediately
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.user;
    const guild = interaction.guild;
    const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);
    const typeId = 'media_apply';
    const ticketType = TICKET_CATEGORIES[typeId];
    const categoryChannel = guild.channels.cache.get(ticketType.categoryId);
    
    // 1. Extract answers from the modal submission
    const answers = {};
    MEDIA_MODAL_FIELDS.forEach(field => {
        answers[field.customId] = interaction.fields.getTextInputValue(field.customId);
    });

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
        } else if (existingTickets && existingTickets.length > 0) {
            const existingTicketChannel = guild.channels.cache.get(existingTickets[0].id);
            if (existingTicketChannel) {
                return interaction.editReply({ content: `You already have an open ticket at ${existingTicketChannel}. Please close that one first.`, ephemeral: true });
            } else {
                await deleteTicket(existingTickets[0].id);
            }
        }
    }
    
    // 2. Create the channel
    const channel = await guild.channels.create({
        name: `media-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        type: ChannelType.GuildText,
        parent: categoryChannel.id,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, 
            { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, 
            { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, 
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, 
        ],
    });

    // 3. Define ticket data including the submitted answers (qna)
    let ticketData = {
        id: channel.id,
        userId: user.id,
        type: typeId,
        claimedBy: null, // Starts unclaimed for staff to review
        // FIX: Use ISO string for database timestamp compatibility
        createdAt: new Date().toISOString(),
        lastUserReplyAt: null,
        qna: answers, // Store the final answers
        isClosed: false,
        controlMessageId: null 
    };

    // 4. Create initial embed with all answers
    const controlsRow = getTicketControlRow(ticketData);

    const summaryEmbed = new EmbedBuilder()
        .setTitle('📸 New Media Application Review')
        .setDescription(`This ticket was opened by <@${user.id}> using the application form. It is now open for <@&${STAFF_ROLE_ID}> to claim and review.`)
        .addFields(
            { name: 'Channel Link', value: answers.youtubeLink || 'N/A', inline: false },
            { name: 'Subscribers/Followers', value: answers.subscribers || 'N/A', inline: true },
            { name: 'Avg. Views', value: answers.avgViews || 'N/A', inline: true },
            { name: 'Prior History?', value: answers.priorHistory || 'N/A', inline: false },
            { name: '\u200B', value: 'Please review the information above and use the buttons below to manage the application.', inline: false },
        )
        .setColor('#2ECC71'); 

    // 5. Send control message
    const controlMessage = await channel.send({ 
        content: `👋 Hey @everyone! <@&${STAFF_ROLE_ID}> New Media Application from <@${user.id}>.`, 
        embeds: [summaryEmbed], 
        components: [controlsRow] 
    });
    
    // 6. Save control message ID and final state
    ticketData.controlMessageId = controlMessage.id;
    await setTicket(channel.id, ticketData);
    
    // 7. Final reply to the user interaction
    await interaction.editReply({ content: `✅ **Application submitted!** Redirecting you to the review channel: ${channel}` });
}


/**
 * Updated to call the Modal for 'media_apply' or proceed with standard ticket creation.
 */
async function handleTicketCreation(interaction, typeId) {
    if (typeId === 'media_apply') {
        // --- NEW: SHOW MODAL INSTEAD OF CREATING CHANNEL ---
        return showMediaModal(interaction); 
        // ----------------------------------------------------
    }
    
    // --- STANDARD TICKET FLOW (Report Exploiters / General Support) ---
    await interaction.deferReply({ ephemeral: true });

    const ticketType = TICKET_CATEGORIES[typeId];
    const user = interaction.user;
    const guild = interaction.guild;
    const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);
    const categoryChannel = guild.channels.cache.get(ticketType.categoryId);

    if (!staffRole || !categoryChannel) {
        return interaction.editReply('Error: Staff role or category channel not found. Bot configuration is incomplete.');
    }

    if (supabase) {
        const { data: existingTickets, error } = await supabase
            .from(TICKET_TABLE)
            .select('id')
            .eq('userId', user.id)
            .limit(1);

        if (error) {
            console.error('Supabase query error:', error);
        } else if (existingTickets && existingTickets.length > 0) {
            const existingTicketChannel = guild.channels.cache.get(existingTickets[0].id);
            if (existingTicketChannel) {
                return interaction.editReply({ content: `You already have an open ticket at ${existingTicketChannel}. Please close that one first.`, ephemeral: true });
            } else {
                await deleteTicket(existingTickets[0].id);
            }
        }
    }


    const channel = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        type: ChannelType.GuildText,
        parent: categoryChannel.id,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, 
            { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, 
            { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, 
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, 
        ],
    });

    let ticketData = {
        id: channel.id,
        userId: user.id,
        type: typeId,
        claimedBy: null, 
        // FIX: Use ISO string for database timestamp compatibility
        createdAt: new Date().toISOString(),
        lastUserReplyAt: null,
        qna: {}, 
        isClosed: false,
        controlMessageId: null 
    };

    await interaction.editReply({ content: `✅ **Ticket created!** Redirecting you to the channel: ${channel}` });

    const controlsRow = getTicketControlRow(ticketData);

    const initialEmbed = new EmbedBuilder()
        .setTitle(`${ticketType.name} Ticket`)
        .setDescription(`Welcome, <@${user.id}>! A staff member will be with you shortly. Please explain your request in detail.`)
        .addFields({ name: 'Type', value: ticketType.name, inline: true })
        .setColor('#5865F2');

    const controlMessage = await channel.send({ 
        content: `👋 Hey @everyone! <@&${STAFF_ROLE_ID}> A new ticket has been opened by <@${user.id}>.`, 
        embeds: [initialEmbed], 
        components: [controlsRow] 
    });
    
    ticketData.controlMessageId = controlMessage.id;
    await setTicket(channel.id, ticketData);
}

async function handleTicketManagement(interaction) {
    const { customId, channel, user, member } = interaction;

    if (!member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.reply({ content: 'You are not a staff member and cannot manage tickets.', ephemeral: true });
    }

    const ticketData = await getTicket(channel.id);
    if (!ticketData) {
        // FIX: Removed the specific database error message
        return interaction.reply({ content: '❌ This action failed because this channel is not a valid ticket.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    if (customId === 'claim_ticket') {
        if (ticketData.claimedBy) {
            return interaction.editReply(`This ticket is already claimed by <@${ticketData.claimedBy}>.`);
        }
        
        await applyClaimLock(channel, user.id);
        const updatedData = { claimedBy: user.id };
        await setTicket(channel.id, updatedData);
        
        await channel.send(`🔒 **Claimed:** This ticket has been claimed by <@${user.id}>. Other staff members can no longer reply.`);
        await interaction.editReply('You have successfully claimed the ticket.');
        
        await updateControlMessage(channel, { id: channel.id, ...updatedData });

    } else if (customId === 'unclaim_ticket') {
        if (!ticketData.claimedBy) {
            return interaction.editReply('This ticket is not currently claimed.');
        }
        
        await unclaimTicket(channel, ticketData);
        await channel.send(`🔓 **Unclaimed:** The ticket has been unclaimed by <@${user.id}> and is now open for any staff member to reply.`);
        await interaction.editReply('You have successfully unclaimed the ticket.');


    } else if (customId === 'close_ticket') {
        await channel.permissionOverwrites.edit(ticketData.userId, { SendMessages: false });
        
        const updatedData = { isClosed: true };
        await setTicket(channel.id, updatedData);
        
        await channel.send(`🛑 **Closed:** The ticket has been closed by <@${user.id}>. Only staff can now delete the ticket. The original user (<@${ticketData.userId}>) can no longer reply.`);
        await interaction.editReply('Ticket closed.');
        
        await updateControlMessage(channel, { id: channel.id, ...updatedData });
        
    } else if (customId === 'delete_ticket') {
        if (!ticketData.isClosed) {
             return interaction.editReply('Please close the ticket first using the "Close" button to prevent user replies during deletion.');
        }
        
        // Use the same deletion logic as the slash command
        await deleteCommand(interaction);
    }
}


// --- MESSAGE MONITORING FOR AUTO-UNCLAIM ---
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const channel = message.channel;
    const ticketData = await getTicket(channel.id);
    if (!ticketData) return; 
    
    // --- QUESTIONNAIRE LOGIC REMOVED HERE ---
    
    // 2. AUTO-UNCLAIM LOGIC (Only runs if a staff member has claimed the ticket)
    if (!ticketData.claimedBy) return; 

    const isStaff = message.member.roles.cache.has(STAFF_ROLE_ID);
    const isClaimant = message.author.id === ticketData.claimedBy;

    if (!isStaff && message.author.id === ticketData.userId) {
        // User replied to a claimed ticket. Reset the staff's 20-minute timer.
        // FIX: Ensure timestamp is saved as ISO string for database compatibility
        const newTimestamp = new Date().toISOString(); 
        ticketData.lastUserReplyAt = newTimestamp;
        await setTicket(channel.id, { lastUserReplyAt: newTimestamp });
        startUnclaimTimer(channel.id);
        console.log(`Timer reset for ticket ${channel.id}. Staff: ${ticketData.claimedBy}`);
    } else if (isClaimant) {
        // Claiming staff replied. If a timer was running, clear it.
        if (activeTimers.has(channel.id)) {
            clearTimeout(activeTimers.get(channel.id));
            activeTimers.delete(channel.id);
            await channel.send('✅ Staff reply received. Auto-unclaim timer cleared.');
        }
    }
});

if (!TOKEN) {
    console.error("DISCORD_TOKEN environment variable is not set. The bot cannot start.");
} else {
    client.login(TOKEN).catch(err => console.error("Failed to log in:", err));
}