// Discord Ticket System Bot Logic (Requires Node.js Environment)
// This file includes:
// 1. Full Supabase persistence for tickets and transcripts.
// 2. Multi-ticket type support (Media, General, Exploiter).
// 3. Auto-unclaim logic for inactive staff.
// 4. Slash commands (/claim, /close) and button controls.

// --- IMPORTS ---
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
    TextInputStyle
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid'); 
const fs = require('fs'); // Required for future staff stats logging

// --- BOT CONFIGURATION ---
// IMPORTANT: These environment variables MUST be set correctly in your host environment.
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID; // The ID of the category where new ticket channels are created
const TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID; // The channel ID where close logs are sent
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const TICKET_PANEL_CHANNEL_ID = process.env.TICKET_PANEL_CHANNEL_ID; // The channel where the ticket button is posted
const TICKET_LIMIT = 5; // Max number of active tickets a user can have

const activeTimers = new Collection(); // Channel ID -> Timeout object

// --- SUPABASE INITIALIZATION ---
let supabase;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET_NAME = 'transcripts'; 
const TICKET_TABLE = 'tickets'; 
const STAFF_STATS_TABLE = 'staff_stats';

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
        // CRITICAL FIX: Explicitly set the schema to 'public' for stable operation.
        supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            db: {
                schema: 'public', 
            },
        });
        console.log("Supabase client initialized successfully.");
    } catch (error) {
        console.error("SUPABASE ERROR: Failed to initialize Supabase client.", error.message);
    }
} else {
    console.error("SUPABASE ERROR: SUPABASE_URL or SUPABASE_ANON_KEY environment variable is not set. The bot will not persist data.");
}

// --- PERSISTENCE FUNCTIONS (Supabase) ---

/**
 * Inserts or updates a ticket row in the Supabase 'tickets' table.
 */
async function setTicket(channelId, data) {
    if (!supabase) {
        console.error(`FATAL SUPABASE ERROR: Supabase client is null. Cannot set ticket ${channelId}.`);
        return { error: 'Supabase client not initialized' };
    }
    
    try {
        const updateData = { id: channelId, ...data };
        
        const { data: result, error } = await supabase
            .from(TICKET_TABLE)
            .upsert(updateData, { onConflict: 'id' })
            .select();

        if (error) {
            console.error(`SUPABASE INSERT REJECTED for ticket ${channelId}. Error details:`, error);
            return { error: error };
        }
        
        console.log(`Successfully UPSERTED ticket ${channelId} to database.`);
        return { data: result[0] };

    } catch (e) {
        console.error(`RUNTIME ERROR during setTicket for ${channelId}:`, e.message, e);
        return { error: e };
    }
}

/**
 * Retrieves ticket data by channel ID.
 */
async function getTicket(channelId) {
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from(TICKET_TABLE)
            .select('*')
            .eq('id', channelId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is 'no rows found'
            console.error(`SUPABASE READ ERROR for ticket ${channelId}:`, error);
            return null;
        }

        return data;
    } catch (e) {
        console.error(`RUNTIME ERROR during getTicket for ${channelId}:`, e.message);
        return null;
    }
}

/**
 * Counts the number of active, non-closed tickets for a user.
 */
async function countActiveTickets(userId) {
    if (!supabase) return 0;

    try {
        const { count, error } = await supabase
            .from(TICKET_TABLE)
            .select('id', { count: 'exact' })
            .eq('userId', userId)
            .eq('isClosed', false);
        
        if (error) {
            console.error("Error counting active tickets:", error);
            return 0;
        }
        return count;
    } catch (e) {
        console.error("Runtime error counting active tickets:", e.message);
        return 0;
    }
}


// --- DISCORD CLIENT INITIALIZATION & COMMANDS ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

client.commands = new Collection();

const claimCommand = new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claims the current ticket.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

const closeCommand = new SlashCommandBuilder()
    .setName('close')
    .setDescription('Closes the current ticket.')
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('The reason for closing the ticket (optional).')
            .setRequired(false));

client.commands.set(claimCommand.name, {
    data: claimCommand,
    execute: handleClaimCommand
});

client.commands.set(closeCommand.name, {
    data: closeCommand,
    execute: handleCloseCommand
});


// --- EVENT LISTENERS ---

client.once('clientReady', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    await registerSlashCommands();
    // This function ensures the panel is always visible after launch.
    await checkAndPostTicketPanel(); 
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command) {
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        }
    } else if (interaction.isButton()) {
        if (interaction.customId === 'create_media_ticket') {
            await handleMediaTicketButton(interaction);
        } else if (interaction.customId === 'create_general_ticket') {
            await handleGeneralTicketButton(interaction);
        } else if (interaction.customId === 'create_exploiter_ticket') {
            await handleExploiterTicketButton(interaction);
        } else if (interaction.customId === 'claim_ticket') {
            await handleClaimCommand(interaction);
        } else if (interaction.customId === 'close_ticket') {
            await handleCloseCommand(interaction);
        }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'media_modal') {
            await handleMediaModalSubmit(interaction);
        } else if (interaction.customId === 'general_modal') {
            await handleGeneralModalSubmit(interaction);
        } else if (interaction.customId === 'exploiter_modal') {
            await handleExploiterModalSubmit(interaction);
        }
    }
});

client.on('messageCreate', async message => {
    if (!message.inGuild() || message.author.bot) return;

    const channel = message.channel;

    // Only process messages in the ticket category
    if (channel.parentId !== TICKET_CATEGORY_ID) return;

    const ticketData = await getTicket(channel.id);
    if (!ticketData || ticketData.isClosed) return; 
    
    // Auto-unclaim logic (only applies if claimed)
    if (!ticketData.claimedBy) return; 

    const isStaff = message.member.roles.cache.has(STAFF_ROLE_ID);
    const isClaimant = message.author.id === ticketData.claimedBy;

    if (!isStaff && message.author.id === ticketData.userId) {
        // User replied to a claimed ticket. Reset staff's 20-minute timer.
        const newTimestamp = new Date().toISOString(); 
        await setTicket(channel.id, { lastUserReplyAt: newTimestamp });
        startUnclaimTimer(channel.id);
        console.log(`Timer reset for ticket ${channel.id}.`);

        // Send a temporary reminder in the channel (optional, but helpful)
        channel.send(`⏰ Staff timer reset by user reply. <@${ticketData.claimedBy}> has 20 minutes to respond.`).then(m => setTimeout(() => m.delete(), 5000)).catch(() => {});

    } else if (isClaimant) {
        // Claiming staff replied. Clear the timer.
        if (activeTimers.has(channel.id)) {
            clearTimeout(activeTimers.get(channel.id));
            activeTimers.delete(channel.id);
            console.log(`Timer cleared for ticket ${channel.id}.`);
            
            // Optionally remove the timer clear message
            try {
                const controlMessage = await channel.messages.fetch(ticketData.controlMessageId);
                const embed = EmbedBuilder.from(controlMessage.embeds[0])
                    .setFooter({ text: 'Staff reply received. Auto-unclaim timer cleared.' });
                await controlMessage.edit({ embeds: [embed] });
            } catch (e) {
                console.error("Could not edit control message after staff reply:", e);
            }
        }
    }
});


// --- COMMAND HANDLERS (Claim/Close) ---

async function handleClaimCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const channel = interaction.channel;
    const staffId = interaction.user.id;
    
    if (channel.parentId !== TICKET_CATEGORY_ID) {
        return interaction.editReply({ content: 'This command can only be used in a ticket channel.', ephemeral: true });
    }

    const ticketData = await getTicket(channel.id);
    if (!ticketData || ticketData.isClosed) {
        return interaction.editReply({ content: 'This channel is not an active ticket channel in the database.', ephemeral: true });
    }
    
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.editReply({ content: 'You must be staff to claim a ticket.', ephemeral: true });
    }

    if (ticketData.claimedBy) {
        return interaction.editReply({ content: `This ticket is already claimed by <@${ticketData.claimedBy}>.`, ephemeral: true });
    }

    const updateResult = await setTicket(channel.id, { claimedBy: staffId });
    if (updateResult.error) {
        return interaction.editReply({ content: 'Failed to update database. Claiming failed.', ephemeral: true });
    }

    // Give staff permission to see/send (if they didn't have it explicitly)
    await channel.permissionOverwrites.edit(staffId, {
        ViewChannel: true,
        SendMessages: true
    });
    
    // Update the control message to show who claimed it
    try {
        const controlMessage = await channel.messages.fetch(ticketData.controlMessageId);
        const embed = EmbedBuilder.from(controlMessage.embeds[0])
            .setDescription(`Ticket claimed by <@${staffId}>.`)
            .setColor(0x00FF00); // Green color for claimed
        await controlMessage.edit({ embeds: [embed], components: [controlMessage.components[0]] });
    } catch (e) {
        console.error("Could not edit control message after claim:", e);
    }

    await channel.send({ content: `<@${staffId}> has claimed this ticket.` });
    await interaction.editReply({ content: 'You have successfully claimed the ticket. The auto-unclaim timer is now active.', ephemeral: true });

    startUnclaimTimer(channel.id);
}


async function handleCloseCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;
    const reason = interaction.options?.getString('reason') || interaction.message?.components[0]?.components[0]?.placeholder || 'No reason provided.';

    if (channel.parentId !== TICKET_CATEGORY_ID) {
        return interaction.editReply({ content: 'This command can only be used in a ticket channel.', ephemeral: true });
    }

    const ticketData = await getTicket(channel.id);
    if (!ticketData || ticketData.isClosed) {
        return interaction.editReply({ content: 'This ticket is already closed or does not exist.', ephemeral: true });
    }

    // Permission check: Staff or the original ticket creator can close
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID) && interaction.user.id !== ticketData.userId) {
        return interaction.editReply({ content: 'You do not have permission to close this ticket.', ephemeral: true });
    }

    // Clear any running unclaim timer
    if (activeTimers.has(channel.id)) {
        clearTimeout(activeTimers.get(channel.id));
        activeTimers.delete(channel.id);
    }

    // 1. Save the transcript to Supabase Storage
    const transcriptUrl = await saveTranscript(channel);

    // 2. Mark as closed in Supabase DB
    const updateResult = await setTicket(channel.id, { 
        isClosed: true, 
        closedAt: new Date().toISOString(),
        closedBy: interaction.user.id,
        transcriptUrl: transcriptUrl,
    });

    if (updateResult.error) {
        await interaction.editReply({ content: 'Failed to update database (Ticket marked as closed). Proceeding with channel deletion.', ephemeral: true });
    } else {
        await interaction.editReply({ content: 'Ticket closed. Channel will be deleted shortly.', ephemeral: true });
    }

    // 3. Send log message to the designated channel
    const logChannel = await channel.guild.channels.fetch(TICKET_LOG_CHANNEL_ID);
    if (logChannel) {
        const logEmbed = new EmbedBuilder()
            .setTitle(`Ticket Closed: #${channel.name}`)
            .addFields(
                { name: 'User', value: `<@${ticketData.userId}>`, inline: true },
                { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Reason', value: reason || 'N/A', inline: false },
                { name: 'Transcript', value: transcriptUrl || 'Failed to generate transcript.', inline: false }
            )
            .setColor(0xFF0000) // Red color for closed
            .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] });
    }

    // 4. Delete channel after a short delay
    setTimeout(() => {
        channel.delete('Ticket closed.').catch(e => console.error("Failed to delete channel:", e));
    }, 5000); 
}


// --- TICKET TYPE HANDLERS (Modals) ---

// 1. MEDIA APPLICATION
async function handleMediaTicketButton(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const activeCount = await countActiveTickets(interaction.user.id);
    if (activeCount >= TICKET_LIMIT) {
        return interaction.editReply({ content: `You already have ${activeCount} active tickets. Please close them before opening a new one.`, ephemeral: true });
    }
    
    const modal = new ModalBuilder()
        .setCustomId('media_modal')
        .setTitle('Media Application Ticket');

    const question1 = new TextInputBuilder()
        .setCustomId('media_q1')
        .setLabel("What is the media link you are applying for?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const question2 = new TextInputBuilder()
        .setCustomId('media_q2')
        .setLabel("Why do you think you should be granted media status?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(question1),
        new ActionRowBuilder().addComponents(question2)
    );

    await interaction.editReply({ content: 'Opening modal...', ephemeral: true });
    await interaction.showModal(modal);
}

async function handleMediaModalSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const q1 = interaction.fields.getTextInputValue('media_q1');
    const q2 = interaction.fields.getTextInputValue('media_q2');

    const user = interaction.user;
    const channelName = `media-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`.substring(0, 50);

    const ticketData = {
        userId: user.id,
        type: 'media_application',
        createdAt: new Date().toISOString(),
        isClosed: false,
        qna: { 'Media Link': q1, 'Reason for Media': q2 },
    };
    
    await createTicketChannel(interaction, channelName, ticketData);
}

// 2. GENERAL SUPPORT
async function handleGeneralTicketButton(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const activeCount = await countActiveTickets(interaction.user.id);
    if (activeCount >= TICKET_LIMIT) {
        return interaction.editReply({ content: `You already have ${activeCount} active tickets. Please close them before opening a new one.`, ephemeral: true });
    }
    
    const modal = new ModalBuilder()
        .setCustomId('general_modal')
        .setTitle('General Support Ticket');

    const question1 = new TextInputBuilder()
        .setCustomId('general_q1')
        .setLabel("Summarize your issue or request in one sentence.")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const question2 = new TextInputBuilder()
        .setCustomId('general_q2')
        .setLabel("Describe your issue in detail (steps taken, errors seen, etc.)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(question1),
        new ActionRowBuilder().addComponents(question2)
    );

    await interaction.editReply({ content: 'Opening modal...', ephemeral: true });
    await interaction.showModal(modal);
}

async function handleGeneralModalSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const q1 = interaction.fields.getTextInputValue('general_q1');
    const q2 = interaction.fields.getTextInputValue('general_q2');

    const user = interaction.user;
    const channelName = `general-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`.substring(0, 50);

    const ticketData = {
        userId: user.id,
        type: 'general_support',
        createdAt: new Date().toISOString(),
        isClosed: false,
        qna: { 'Summary': q1, 'Detailed Description': q2 },
    };
    
    await createTicketChannel(interaction, channelName, ticketData);
}

// 3. EXPLOITER REPORT
async function handleExploiterTicketButton(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const activeCount = await countActiveTickets(interaction.user.id);
    if (activeCount >= TICKET_LIMIT) {
        return interaction.editReply({ content: `You already have ${activeCount} active tickets. Please close them before opening a new one.`, ephemeral: true });
    }
    
    const modal = new ModalBuilder()
        .setCustomId('exploiter_modal')
        .setTitle('Exploiter Report Ticket');

    const question1 = new TextInputBuilder()
        .setCustomId('exploiter_q1')
        .setLabel("Exploiter's Username or ID (or 'Anonymous')")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const question2 = new TextInputBuilder()
        .setCustomId('exploiter_q2')
        .setLabel("Detailed Description of the Exploit (include video proof link if possible)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(question1),
        new ActionRowBuilder().addComponents(question2)
    );

    await interaction.editReply({ content: 'Opening modal...', ephemeral: true });
    await interaction.showModal(modal);
}

async function handleExploiterModalSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const q1 = interaction.fields.getTextInputValue('exploiter_q1');
    const q2 = interaction.fields.getTextInputValue('exploiter_q2');

    const user = interaction.user;
    const channelName = `exploit-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`.substring(0, 50);

    const ticketData = {
        userId: user.id,
        type: 'exploiter_report',
        createdAt: new Date().toISOString(),
        isClosed: false,
        qna: { 'Exploiter ID': q1, 'Exploit Details': q2 },
    };
    
    await createTicketChannel(interaction, channelName, ticketData);
}


// --- SHARED TICKET CREATION FUNCTION ---

/**
 * Creates the Discord channel, inserts ticket data into Supabase, and posts the control message.
 */
async function createTicketChannel(interaction, channelName, ticketData) {
    const guild = interaction.guild;
    const user = interaction.user;

    try {
        // 1. Create the Discord Channel
        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: TICKET_CATEGORY_ID,
            topic: `${ticketData.type} ticket for ${user.tag} (${user.id})`,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            ],
        });

        // 2. Insert into Supabase
        const dbResult = await setTicket(channel.id, ticketData);
        if (dbResult.error) {
             // Rollback: delete the channel if the DB operation failed.
             await channel.delete('Database insertion failed. Ghost ticket prevention.');
             return interaction.editReply({ content: `❌ Ticket creation failed: Could not save data to the database. The channel was automatically deleted. Please contact a server admin.`, ephemeral: true });
        }

        // 3. Construct the initial embed
        const embed = new EmbedBuilder()
            .setTitle(`New ${ticketData.type.toUpperCase().replace(/_/g, ' ')} Ticket - ${user.tag}`)
            .setDescription('**A staff member will be with you shortly to review your request.**')
            .addFields(
                { name: 'Applicant', value: `<@${user.id}>`, inline: true },
                { name: 'Application Type', value: ticketData.type.replace(/_/g, ' ').toUpperCase(), inline: true }
            );

        // Add Q&A fields dynamically
        for (const [key, value] of Object.entries(ticketData.qna)) {
            embed.addFields({ name: key, value: value.length > 1024 ? value.substring(0, 1021) + '...' : value, inline: false });
        }
            
        embed.setColor(0x00BFFF) 
             .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('Claim Ticket')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

        // 4. Send the initial message with controls
        const controlMessage = await channel.send({ 
            content: `<@&${STAFF_ROLE_ID}> New Ticket opened by <@${user.id}>!`, 
            embeds: [embed], 
            components: [row] 
        });

        // 5. Update the ticket data with the control message ID
        await setTicket(channel.id, { controlMessageId: controlMessage.id });

        // 6. Final success reply
        await interaction.editReply({ 
            content: `✅ Your ticket has been created! Head over to ${channel}.`, 
            ephemeral: true 
        });

    } catch (e) {
        console.error(`Error handling ${ticketData.type} modal submission and ticket creation:`, e);
        await interaction.editReply({ content: 'An unexpected error occurred during ticket creation. Please try again.', ephemeral: true });
    }
}


// --- UTILITIES AND HELPERS ---

/**
 * Creates or updates the static ticket creation panel in the designated channel.
 */
async function checkAndPostTicketPanel() {
    const channel = await client.channels.fetch(TICKET_PANEL_CHANNEL_ID).catch(() => null);
    if (!channel) {
        return console.error("TICKET_PANEL_CHANNEL_ID is invalid or bot cannot access it.");
    }

    const embed = new EmbedBuilder()
        .setTitle('🎫 Create a Support Ticket')
        .setDescription('Please select the type of assistance you need below.')
        .setColor(0x007FFF);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_media_ticket')
                .setLabel('Media Application')
                .setEmoji('🎥')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('create_general_ticket')
                .setLabel('General Support')
                .setEmoji('💬')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('create_exploiter_ticket')
                .setLabel('Exploiter Report')
                .setEmoji('⚠️')
                .setStyle(ButtonStyle.Danger)
        );

    // Try to find the existing panel message
    const messages = await channel.messages.fetch({ limit: 5 });
    const existingMessage = messages.find(m => 
        m.author.id === client.user.id && 
        m.embeds.length > 0 && 
        m.embeds[0].title === '🎫 Create a Support Ticket'
    );

    if (existingMessage) {
        await existingMessage.edit({ embeds: [embed], components: [row] });
        console.log("Ticket panel updated successfully.");
    } else {
        await channel.send({ embeds: [embed], components: [row] });
        console.log("New ticket panel posted successfully.");
    }
}

/**
 * Registers global slash commands.
 */
async function registerSlashCommands() {
    const commands = [];
    client.commands.forEach(command => commands.push(command.data.toJSON()));

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        await guild.commands.set(commands);
        console.log(`Slash commands registered successfully to guild ${GUILD_ID}.`);
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
}

/**
 * Sets a timer for 20 minutes to auto-unclaim a ticket if the staff member is inactive.
 */
function startUnclaimTimer(channelId) {
    if (activeTimers.has(channelId)) {
        clearTimeout(activeTimers.get(channelId));
    }
    
    const UNCLAIM_TIMEOUT = 20 * 60 * 1000; // 20 minutes
    
    const timer = setTimeout(async () => {
        const ticketData = await getTicket(channelId);
        if (!ticketData || !ticketData.claimedBy || ticketData.isClosed) {
            activeTimers.delete(channelId);
            return;
        }

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            activeTimers.delete(channelId);
            return;
        }

        const staffId = ticketData.claimedBy;

        // Unclaim the ticket in the database
        await setTicket(channelId, { claimedBy: null });
        
        await channel.send({
            content: `<@&${STAFF_ROLE_ID}> **[AUTO-UNCLAIM]** The ticket has been automatically unclaimed because <@${staffId}> was inactive for 20 minutes after the user's last reply. Please claim to assist.`,
        });

        // Update the control message to show it's unclaimed
        try {
            const controlMessage = await channel.messages.fetch(ticketData.controlMessageId);
            const embed = EmbedBuilder.from(controlMessage.embeds[0])
                .setDescription(`Ticket is currently **unclaimed**.\nStaff: <@&${STAFF_ROLE_ID}>`)
                .setColor(0xFF8C00); // Orange color for unclaimed
            await controlMessage.edit({ embeds: [embed], components: [controlMessage.components[0]] });
        } catch (e) {
            console.error("Could not edit control message after auto-unclaim:", e);
        }

        activeTimers.delete(channelId);
        console.log(`Ticket ${channelId} auto-unclaimed.`);

    }, UNCLAIM_TIMEOUT);

    activeTimers.set(channelId, timer);
}


/**
 * Transcribes the channel messages and uploads the text to Supabase Storage.
 */
async function saveTranscript(channel) {
    if (!supabase) return null;

    try {
        // Fetch up to 100 messages (Discord limit per fetch)
        const messages = await channel.messages.fetch({ limit: 100 }); 
        const transcriptLines = messages
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .map(msg => `[${msg.createdAt.toISOString()}] ${msg.author.tag}: ${msg.content}`)
            .join('\n');

        const ticketData = await getTicket(channel.id);
        const ticketType = ticketData?.type.toUpperCase().replace(/_/g, ' ') || 'Unknown';

        const transcriptContent = 
            `--- Transcript for ${ticketType} Ticket ${channel.name} (${channel.id}) ---\n` +
            `Created By: ${ticketData?.userId} | Closed By: ${ticketData?.closedBy}\n` +
            `Closed At: ${new Date().toISOString()}\n\n` +
            transcriptLines;

        const fileName = `transcript-${channel.id}-${Date.now()}.txt`;
        
        const { error } = await supabase.storage
            .from(STORAGE_BUCKET_NAME)
            .upload(fileName, transcriptContent, {
                contentType: 'text/plain',
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            console.error("Supabase Storage Upload Error:", error);
            return null;
        }

        const { data: publicUrlData } = supabase.storage
            .from(STORAGE_BUCKET_NAME)
            .getPublicUrl(fileName);

        return publicUrlData.publicUrl;

    } catch (e) {
        console.error("RUNTIME ERROR during transcript saving:", e);
        return null;
    }
}

// --- START BOT ---
client.login(TOKEN).catch(e => console.error("Failed to log in to Discord:", e));
