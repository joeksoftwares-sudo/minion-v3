// Discord Ticket System Bot Logic (Node.js)
// Features: Multi-Type Tickets, Supabase Persistence, Auto-Unclaim Timer, Manual /panel Command.

// --- 1. IMPORTS AND DEPENDENCIES ---
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

// --- 2. BOT CONFIGURATION (MUST BE SET VIA ENVIRONMENT VARIABLES) ---
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID; // Guild where commands and channels are created
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID; // Parent category for new tickets
const TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID; // Channel for transcript links
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID; // Role that can claim/close tickets

// Constants
const TICKET_TABLE = 'tickets'; 
const STORAGE_BUCKET_NAME = 'transcripts'; 
const TICKET_LIMIT = 5; // Max active tickets per user
const UNCLAIM_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes for auto-unclaim

// Internal State Managers
const activeTimers = new Collection(); // Channel ID -> Timeout object

// --- 3. SUPABASE INITIALIZATION ---
let supabase;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
        // CRITICAL FIX: Explicitly set the schema to 'public' for stable operation.
        supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            db: {
                schema: 'public', 
            },
        });
        console.log("[DB] Supabase client initialized successfully.");
    } catch (error) {
        console.error("[DB ERROR] Failed to initialize Supabase client.", error.message);
    }
} else {
    console.warn("[DB WARNING] Supabase environment variables are missing. The bot will run without persistence (data loss on restart is expected).");
}

// --- 4. DATABASE FUNCTIONS (Supabase) ---

/**
 * Inserts or updates a ticket row in the 'tickets' table.
 */
async function setTicket(channelId, data) {
    if (!supabase) return { error: 'DB not initialized' };
    
    try {
        const updateData = { id: channelId, ...data };
        
        const { error } = await supabase
            .from(TICKET_TABLE)
            .upsert(updateData, { onConflict: 'id' })
            .select();

        if (error) {
            console.error(`[DB] UPSERT REJECTED for ${channelId}:`, error);
            return { error: error };
        }
        return { success: true };

    } catch (e) {
        console.error(`[DB] RUNTIME ERROR during setTicket for ${channelId}:`, e.message);
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
            console.error(`[DB] READ ERROR for ticket ${channelId}:`, error);
            return null;
        }

        return data;
    } catch (e) {
        console.error(`[DB] RUNTIME ERROR during getTicket for ${channelId}:`, e.message);
        return null;
    }
}

/**
 * Counts the number of active (isClosed=false) tickets for a specific user ID.
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
            console.error("[DB] Error counting active tickets:", error);
            return 0;
        }
        return count;
    } catch (e) {
        console.error("[DB] Runtime error counting active tickets:", e.message);
        return 0;
    }
}


// --- 5. DISCORD CLIENT SETUP & COMMANDS REGISTRATION ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.GuildMember],
});

client.commands = new Collection();

// Slash Command Definitions
const panelCommand = new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Posts the main ticket creation panel in the current channel.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator); // Admin-only

const claimCommand = new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claims the current ticket for a staff member.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

const closeCommand = new SlashCommandBuilder()
    .setName('close')
    .setDescription('Closes the current ticket and archives the transcript.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('The reason for closing the ticket.')
            .setRequired(false));

client.commands.set(panelCommand.name, { data: panelCommand, execute: handlePanelCommand });
client.commands.set(claimCommand.name, { data: claimCommand, execute: handleClaimCommand });
client.commands.set(closeCommand.name, { data: closeCommand, execute: handleCloseCommand });


// --- 6. EVENT LISTENERS ---

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    await registerSlashCommands();
    // Removed: The old checkAndPostTicketPanel() logic is now gone. 
    // The panel must be posted manually using /panel.
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command) {
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing command ${interaction.commandName}:`, error);
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        }
    } else if (interaction.isButton()) {
        // Handle all three ticket buttons and control buttons
        const buttonId = interaction.customId;
        if (buttonId === 'claim_ticket') return handleClaimCommand(interaction);
        if (buttonId === 'close_ticket') return handleCloseCommand(interaction);
        
        if (buttonId.startsWith('create_')) {
            await handleTicketButton(interaction, buttonId.replace('create_', ''));
        }

    } else if (interaction.isModalSubmit()) {
        // Handle all three modal submissions
        const modalId = interaction.customId;
        if (modalId === 'media_modal') return handleModalSubmit(interaction, 'media');
        if (modalId === 'general_modal') return handleModalSubmit(interaction, 'general');
        if (modalId === 'exploiter_modal') return handleModalSubmit(interaction, 'exploiter');
    }
});

client.on('messageCreate', async message => {
    if (!message.inGuild() || message.author.bot || message.channel.parentId !== TICKET_CATEGORY_ID) return;
    
    const channelId = message.channel.id;
    const ticketData = await getTicket(channelId);
    if (!ticketData || ticketData.isClosed || !ticketData.claimedBy) return; // Only process active, claimed tickets

    const isStaff = message.member.roles.cache.has(STAFF_ROLE_ID);
    const isClaimant = message.author.id === ticketData.claimedBy;

    if (!isStaff && message.author.id === ticketData.userId) {
        // Logic: User replied to the claimed ticket -> Reset the 20-minute staff timer.
        const newTimestamp = new Date().toISOString(); 
        await setTicket(channelId, { lastUserReplyAt: newTimestamp });
        startUnclaimTimer(channelId, ticketData.claimedBy);
        console.log(`[Timer] Reset for ticket ${channelId}.`);

    } else if (isClaimant) {
        // Logic: Claiming staff replied -> Clear the timer.
        if (activeTimers.has(channelId)) {
            clearTimeout(activeTimers.get(channelId));
            activeTimers.delete(channelId);
            console.log(`[Timer] Cleared for ticket ${channelId}.`);
            
            // Optionally update the control message footer to remove the timer status.
            try {
                const controlMessage = await message.channel.messages.fetch(ticketData.controlMessageId);
                const embed = EmbedBuilder.from(controlMessage.embeds[0])
                    .setFooter(null); // Remove footer
                await controlMessage.edit({ embeds: [embed] });
            } catch (e) {
                // Ignore failure if message is not found/editable
            }
        }
    }
});


// --- 7. TICKET PANEL MANAGEMENT (/panel command handler) ---

/**
 * Creates the embed and action row components for the ticket panel.
 */
function createPanelComponentsAndEmbed() {
    const embed = new EmbedBuilder()
        .setTitle('🎫 Discord Support & Application Center')
        .setDescription('Please select the appropriate button below to open a ticket. **Only 1 active ticket per person allowed.**')
        .setColor(0x007FFF);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('create_media')
                .setLabel('🎥 Media Application')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('create_general')
                .setLabel('💬 General Support')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('create_exploiter')
                .setLabel('⚠️ Exploiter Report')
                .setStyle(ButtonStyle.Danger)
        );
    
    return { embed, row };
}

/**
 * Posts the ticket panel message to a specific channel.
 */
async function postTicketPanelMessage(channel) {
    if (!channel) return false;
    
    try {
        const { embed, row } = createPanelComponentsAndEmbed();
        await channel.send({ embeds: [embed], components: [row] });
        console.log(`[Panel] New ticket panel posted successfully in #${channel.name}.`);
        return true;
    } catch (e) {
        console.error("[Panel] Error posting panel:", e);
        return false;
    }
}

/**
 * Handler for the /panel slash command.
 */
async function handlePanelCommand(interaction) {
    if (!interaction.inGuild()) return;

    // Check for administrator permission (already defined in command setup, but good practice to double check)
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'You must be an administrator to use the `/panel` command.', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    const success = await postTicketPanelMessage(interaction.channel);

    if (success) {
        await interaction.editReply({ content: '✅ Ticket panel successfully posted in this channel.', ephemeral: true });
    } else {
        await interaction.editReply({ content: '❌ Failed to post the ticket panel. Check the bot\'s permissions in this channel or the console for errors.', ephemeral: true });
    }
}


// --- 8. MODAL HANDLERS ---

// Defines the content for each ticket type (used by handleTicketButton and handleModalSubmit)
const ticketConfigs = {
    media: {
        title: 'Media Application',
        color: 0x00FF00,
        fields: [
            { customId: 'q1_link', label: "What is the media link you are applying for?", style: TextInputStyle.Short, required: true },
            { customId: 'q2_reason', label: "Why do you think you should be granted media status?", style: TextInputStyle.Paragraph, required: true }
        ],
        channelPrefix: 'media',
    },
    general: {
        title: 'General Support',
        color: 0xFFA500,
        fields: [
            { customId: 'q1_summary', label: "Summarize your issue or request in one sentence.", style: TextInputStyle.Short, required: true },
            { customId: 'q2_detail', label: "Describe your issue in detail (steps taken, errors, etc.)", style: TextInputStyle.Paragraph, required: true }
        ],
        channelPrefix: 'general',
    },
    exploiter: {
        title: 'Exploiter Report',
        color: 0xFF0000,
        fields: [
            { customId: 'q1_target', label: "Exploiter's Username or ID (or 'Anonymous')", style: TextInputStyle.Short, required: true },
            { customId: 'q2_proof', label: "Detailed Description of the Exploit (include video proof link if possible)", style: TextInputStyle.Paragraph, required: true }
        ],
        channelPrefix: 'exploit',
    }
};

/**
 * Handles all ticket button clicks (opens the correct modal).
 */
async function handleTicketButton(interaction, type) {
    await interaction.deferReply({ ephemeral: true });
    
    const activeCount = await countActiveTickets(interaction.user.id);
    if (activeCount >= TICKET_LIMIT) {
        return interaction.editReply({ 
            content: `❌ You already have ${activeCount} active tickets (Limit: ${TICKET_LIMIT}). Please close them before opening a new one.`, 
            ephemeral: true 
        });
    }

    const config = ticketConfigs[type];
    if (!config) return interaction.editReply({ content: 'Invalid ticket type selected.', ephemeral: true });
    
    const modal = new ModalBuilder()
        .setCustomId(`${type}_modal`)
        .setTitle(config.title);

    config.fields.forEach(fieldConfig => {
        const input = new TextInputBuilder()
            .setCustomId(fieldConfig.customId)
            .setLabel(fieldConfig.label)
            .setStyle(fieldConfig.style)
            .setRequired(fieldConfig.required);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
    });

    await interaction.showModal(modal);
    // Modal submission handles the final interaction response.
}

/**
 * Handles all modal submissions (processes input and creates the channel).
 */
async function handleModalSubmit(interaction, type) {
    await interaction.deferReply({ ephemeral: true });

    const config = ticketConfigs[type];
    const user = interaction.user;

    const qna = {};
    config.fields.forEach(fieldConfig => {
        // Map the customId back to the label for storage
        qna[fieldConfig.label] = interaction.fields.getTextInputValue(fieldConfig.customId);
    });

    const channelName = `${config.channelPrefix}-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`.substring(0, 50);

    const ticketData = {
        userId: user.id,
        type: config.title.toLowerCase().replace(/\s/g, '_'),
        createdAt: new Date().toISOString(),
        isClosed: false,
        claimedBy: null,
        qna: qna,
    };
    
    await createTicketChannel(interaction, channelName, ticketData, config.color);
}


// --- 9. TICKET CREATION CORE FUNCTION ---

/**
 * Creates the Discord channel, inserts ticket data into Supabase, and posts the control message.
 */
async function createTicketChannel(interaction, channelName, ticketData, color) {
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
                // Staff role gets immediate view/send access
                { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, 
            ],
        });

        // 2. Insert into Supabase (add channel ID to data)
        const dbResult = await setTicket(channel.id, { ...ticketData, id: channel.id });
        if (dbResult.error) {
             // Rollback: delete the channel if the DB operation failed.
             await channel.delete('Database insertion failed. Ghost ticket prevention.').catch(() => {});
             return interaction.editReply({ content: `❌ Ticket creation failed: Could not save data to the database. The channel was automatically deleted. Please contact a server admin.`, ephemeral: true });
        }

        // 3. Construct the initial embed
        const embed = new EmbedBuilder()
            .setTitle(`New Ticket: ${ticketData.type.toUpperCase().replace(/_/g, ' ')}`)
            .setDescription('Ticket is currently **unclaimed**.\n**A staff member will be with you shortly to review your request.**')
            .addFields(
                { name: 'User', value: `<@${user.id}>`, inline: true },
                { name: 'Ticket Type', value: ticketData.type.replace(/_/g, ' ').toUpperCase(), inline: true }
            );

        // Add Q&A fields
        for (const [key, value] of Object.entries(ticketData.qna)) {
            embed.addFields({ name: `[Q] ${key}`, value: value.length > 1024 ? value.substring(0, 1021) + '...' : value, inline: false });
        }
            
        embed.setColor(color) 
             .setTimestamp();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('Claim Ticket')
                    .setEmoji('✋')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setEmoji('🔒')
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
        console.error(`Error during ticket creation for ${user.id}:`, e);
        await interaction.editReply({ content: 'An unexpected error occurred during ticket creation. Please try again.', ephemeral: true });
    }
}


// --- 10. COMMAND LOGIC (Claim/Close) ---

async function handleClaimCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const channel = interaction.channel;
    const staffId = interaction.user.id;
    
    if (channel.parentId !== TICKET_CATEGORY_ID || !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
        return interaction.editReply({ content: 'This command can only be used by staff in a ticket channel.', ephemeral: true });
    }

    const ticketData = await getTicket(channel.id);
    if (!ticketData || ticketData.isClosed) {
        return interaction.editReply({ content: 'This is not an active ticket.', ephemeral: true });
    }

    if (ticketData.claimedBy) {
        return interaction.editReply({ content: `This ticket is already claimed by <@${ticketData.claimedBy}>.`, ephemeral: true });
    }

    // 1. Update database
    const updateResult = await setTicket(channel.id, { claimedBy: staffId, lastUserReplyAt: new Date().toISOString() });
    if (updateResult.error) {
        return interaction.editReply({ content: 'Failed to update database. Claiming failed.', ephemeral: true });
    }
    
    // 2. Update the control message
    try {
        const controlMessage = await channel.messages.fetch(ticketData.controlMessageId);
        const embed = EmbedBuilder.from(controlMessage.embeds[0])
            .setDescription(`Ticket claimed by <@${staffId}>.`)
            .setColor(0x00FF00); // Green
        
        // Add a footer indicating the timer status
        embed.setFooter({ text: 'Auto-unclaim timer started. Staff must reply within 20 mins of the user\'s message.' });
        
        await controlMessage.edit({ embeds: [embed], components: [controlMessage.components[0]] });
    } catch (e) {
        console.error("Could not edit control message after claim:", e);
    }

    // 3. Send channel notification and start timer
    await channel.send({ content: `<@${staffId}> has claimed this ticket. Please be patient while they review your request.` });
    await interaction.editReply({ content: 'You have successfully claimed the ticket. The auto-unclaim timer is now active.', ephemeral: true });
    startUnclaimTimer(channel.id, staffId);
}


async function handleCloseCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;
    const reason = interaction.options?.getString('reason') || 'No reason provided.';

    if (channel.parentId !== TICKET_CATEGORY_ID) {
        return interaction.editReply({ content: 'This command can only be used in a ticket channel.', ephemeral: true });
    }

    const ticketData = await getTicket(channel.id);
    if (!ticketData || ticketData.isClosed) {
        return interaction.editReply({ content: 'This ticket is already closed or does not exist.', ephemeral: true });
    }

    // Staff or the original ticket creator can close
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID) && interaction.user.id !== ticketData.userId) {
        return interaction.editReply({ content: 'You do not have permission to close this ticket.', ephemeral: true });
    }

    // 1. Clear any running unclaim timer
    if (activeTimers.has(channel.id)) {
        clearTimeout(activeTimers.get(channel.id));
        activeTimers.delete(channel.id);
    }

    // 2. Save the transcript
    const transcriptUrl = await saveTranscript(channel, ticketData);
    
    // 3. Mark as closed in Supabase DB
    const updateResult = await setTicket(channel.id, { 
        isClosed: true, 
        closedAt: new Date().toISOString(),
        closedBy: interaction.user.id,
        transcriptUrl: transcriptUrl,
    });

    if (updateResult.error) {
        await interaction.editReply({ content: 'Failed to update database (Ticket marked as closed). Channel will be deleted.', ephemeral: true });
    } else {
        await interaction.editReply({ content: 'Ticket closed and archived. Channel will be deleted shortly.', ephemeral: true });
    }

    // 4. Send log message
    const logChannel = await channel.guild.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
    if (logChannel) {
        const logEmbed = new EmbedBuilder()
            .setTitle(`🔒 Ticket Closed: #${channel.name}`)
            .addFields(
                { name: 'User', value: `<@${ticketData.userId}>`, inline: true },
                { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Claimed By', value: ticketData.claimedBy ? `<@${ticketData.claimedBy}>` : 'Unclaimed', inline: true },
                { name: 'Reason', value: reason || 'N/A', inline: false },
                { name: 'Transcript Link', value: transcriptUrl || 'Failed to generate transcript.', inline: false }
            )
            .setColor(0x800080) // Purple for closure
            .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] });
    }

    // 5. Delete channel after a short delay
    setTimeout(() => {
        channel.delete('Ticket closed and archived.').catch(e => console.error("Failed to delete channel:", e));
    }, 5000); 
}


// --- 11. UTILITY FUNCTIONS ---

/**
 * Sets a timer for 20 minutes to auto-unclaim a ticket if the staff member is inactive.
 */
function startUnclaimTimer(channelId, claimedBy) {
    if (activeTimers.has(channelId)) {
        clearTimeout(activeTimers.get(channelId));
    }
    
    const timer = setTimeout(async () => {
        const ticketData = await getTicket(channelId);
        if (!ticketData || ticketData.isClosed || ticketData.claimedBy !== claimedBy) {
            // Check if it was claimed by someone else while the timer was running, or if closed.
            activeTimers.delete(channelId);
            return;
        }

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            activeTimers.delete(channelId);
            return;
        }

        // Action: Auto-unclaim the ticket
        await setTicket(channelId, { claimedBy: null });
        
        await channel.send({
            content: `<@&${STAFF_ROLE_ID}> **[AUTO-UNCLAIM]** The ticket was automatically unclaimed because <@${claimedBy}> was inactive for 20 minutes after the user's last reply. Please use \`/claim\` to assist.`,
        });

        // Update the control message to show it's unclaimed
        try {
            const controlMessage = await channel.messages.fetch(ticketData.controlMessageId);
            const embed = EmbedBuilder.from(controlMessage.embeds[0])
                .setDescription(`Ticket is currently **unclaimed**.\nStaff: <@&${STAFF_ROLE_ID}>`)
                .setColor(0xFF8C00) // Orange
                .setFooter(null); // Clear timer footer
            await controlMessage.edit({ embeds: [embed], components: [controlMessage.components[0]] });
        } catch (e) {
            console.error("Could not edit control message after auto-unclaim:", e);
        }

        activeTimers.delete(channelId);
        console.log(`[Timer] Ticket ${channelId} auto-unclaimed.`);

    }, UNCLAIM_TIMEOUT_MS);

    activeTimers.set(channelId, timer);
}

/**
 * Transcribes the channel messages and uploads the text to Supabase Storage.
 */
async function saveTranscript(channel, ticketData) {
    if (!supabase) return null;

    try {
        // Fetch up to 200 messages (Discord limit is 100 per call, fetch twice if needed)
        const messages = await channel.messages.fetch({ limit: 200 }); 
        const transcriptLines = messages
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .map(msg => `[${msg.createdAt.toISOString()}] ${msg.author.tag} (${msg.author.id}): ${msg.content}`)
            .join('\n');

        const ticketType = ticketData.type.toUpperCase().replace(/_/g, ' ');

        const transcriptContent = 
            `--- Transcript for ${ticketType} Ticket #${channel.name} (${channel.id}) ---\n` +
            `User ID: ${ticketData.userId}\nClaimed By: ${ticketData.claimedBy || 'N/A'}\nClosed By: ${ticketData.closedBy}\n` +
            `Closed At: ${new Date().toISOString()}\n\n` +
            transcriptLines;

        const fileName = `transcript/${channel.id}-${Date.now()}.txt`;
        
        const { error } = await supabase.storage
            .from(STORAGE_BUCKET_NAME)
            .upload(fileName, transcriptContent, {
                contentType: 'text/plain',
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            console.error("[DB] Supabase Storage Upload Error:", error);
            return null;
        }

        const { data: publicUrlData } = supabase.storage
            .from(STORAGE_BUCKET_NAME)
            .getPublicUrl(fileName);

        return publicUrlData.publicUrl;

    } catch (e) {
        console.error("[DB] RUNTIME ERROR during transcript saving:", e);
        return null;
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
        console.error('Failed to register slash commands. Check GUILD_ID and bot permissions:', error);
    }
}

// --- 12. START BOT ---
client.login(TOKEN).catch(e => console.error("FATAL ERROR: Failed to log in to Discord. Check DISCORD_TOKEN:", e));
