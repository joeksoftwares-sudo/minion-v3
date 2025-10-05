// Discord Ticket System Bot - Built for Railway.app with In-Memory Storage
// WARNING: All data in this file will be lost if the bot restarts or redeploys!
// FIXES: 
// 1. Critical Fix: Modal label length constraint violation resolved in 'Apply for Media' modal for the SECOND input field.
// 2. Deprecation Fixes: Replaced 'ready' with 'clientReady', 'isSelectMenu' with 'isStringSelectMenu', and 'ephemeral: true' with 'flags: 64'.
// 3. Allowed STAFF_ROLE_ID to use the "Finalize & Delete" button.

const {
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
    StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
    TextInputStyle, ChannelType, PermissionsBitField, AttachmentBuilder,
    Collection,
    // Import Flags constant for ephemeral replacement
    MessageFlags
} = require('discord.js');

// Use the official flags constant (value is 64)
const EPHEMERAL_FLAG = MessageFlags.Ephemeral;

// --- Configuration from Environment Variables ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
// POSTGRES_URL is no longer needed
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID; 
const TICKET_PANEL_CHANNEL_ID = process.env.TICKET_PANEL_CHANNEL_ID;
const TRANSCRIPT_LOG_CHANNEL_ID = process.env.TRANSCRIPT_LOG_CHANNEL_ID;
const ADMIN_APPROVAL_CHANNEL_ID = process.env.ADMIN_APPROVAL_CHANNEL_ID;
const MEDIA_CATEGORY_ID = process.env.MEDIA_CATEGORY_ID;
const REPORT_CATEGORY_ID = process.env.REPORT_CATEGORY_ID;
const SUPPORT_CATEGORY_ID = process.env.SUPPORT_CATEGORY_ID;

// Payout Values (Robux)
const PAYOUT_VALUES = {
    'General Support': 15,
    'Report Exploiters': 20,
    'Apply for Media': 25,
};

// Payout Limits (Robux)
const PAYOUT_MIN = 300;
const PAYOUT_MAX = 700;
const UNCLAIM_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

// --- Global State & Cache (In-Memory Storage) ---
// WARNING: All data in these Maps/Arrays will be lost if the bot restarts or redeploys!

// Stores { user_id -> { robux_balance: number } }
const staffData = new Map(); 
// Stores { channel_id -> { ... ticket data ... } }
const ticketLogs = new Map(); 
// Stores transaction history (used for logging only)
let transactionCounter = 0;
const transactionLogs = []; 

// Cache for managing claimed ticket state (only used for the unclaim timer)
const claimedTickets = new Collection(); 

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
    // Simulate database check for 'end_time IS NULL'
    return (log && log.end_time === null) ? log : null;
}


// --- Discord Client Setup ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

// FIX: Renamed 'ready' to 'clientReady' to resolve deprecation warning
client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('⚠️ WARNING: Using In-Memory Storage. All data will be lost on bot restart/redeploy.');
    await registerSlashCommands(client.application.id);
    await setupTicketPanel();
});

// --- Command and Panel Setup Functions ---

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
            name: 'panel',
            description: 'ADMIN ONLY: Deploys the persistent ticket panel.',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
        },
        {
            name: 'close-ticket',
            description: 'STAFF ONLY: Soft-close the current ticket (adds Robux).',
        },
        {
            name: 'delete-ticket',
            description: 'ADMIN ONLY: Generate transcript and finalize/delete the ticket.',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
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

    // FIX: Using StringSelectMenuBuilder to resolve deprecation warning and prevent interaction failures
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
        // Soft-Closed: Show Finalize & Delete button
        closeOrDeleteButton = new ButtonBuilder()
            .setCustomId('ticket_finalize_delete')
            .setLabel('Finalize & Delete')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('💣');
    } else {
        // Not Soft-Closed: Show Soft Close button
        closeOrDeleteButton = new ButtonBuilder()
            .setCustomId('ticket_soft_close')
            .setLabel('Close')
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


// --- Transcript and Logging Helper (No Change) ---

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

// --- Interaction Handlers ---

client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        await handleSlashCommand(interaction);
    // FIX: Replaced isSelectMenu() with isStringSelectMenu()
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
    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
    if (!interaction.inGuild()) return interaction.reply({ content: 'This command must be run in a server.', flags: EPHEMERAL_FLAG });

    const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    try {
        switch (interaction.commandName) {
            case 'panel':
                // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                if (!isAdmin) return interaction.reply({ content: 'You need Administrator permissions to set up the panel.', flags: EPHEMERAL_FLAG });
                const { embed, row } = createTicketPanel();
                await interaction.channel.send({ embeds: [embed], components: [row] });
                // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                await interaction.reply({ content: 'Ticket panel deployed successfully.', flags: EPHEMERAL_FLAG });
                break;

            case 'check-robux':
                // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                if (!isStaff) return interaction.reply({ content: 'You must be a staff member to use this command.', flags: EPHEMERAL_FLAG });
                
                try {
                    // --- IN-MEMORY BALANCE CHECK ---
                    const data = staffData.get(interaction.user.id);
                    const balance = data ? data.robux_balance : 0;
                    // -------------------------------

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
                    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                    await interaction.reply({ embeds: [embed], flags: EPHEMERAL_FLAG });
                } catch (error) {
                    console.error('Error checking balance:', error);
                    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                    await interaction.reply({ content: 'An error occurred while fetching your balance.', flags: EPHEMERAL_FLAG });
                }
                break;

            case 'payout':
                // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
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
                
            case 'close-ticket':
                // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                if (!isStaff) return interaction.reply({ content: 'You must be staff to use this command.', flags: EPHEMERAL_FLAG });
                await interaction.deferReply({ flags: EPHEMERAL_FLAG }); // Also using flag here
                await handleSoftCloseLogic(interaction, interaction.channel.id, interaction.user.id, true);
                break;
                
            case 'delete-ticket':
                // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                if (!isAdmin) return interaction.reply({ content: 'You must be an admin to use this command.', flags: EPHEMERAL_FLAG });
                await interaction.deferReply({ flags: EPHEMERAL_FLAG }); // Also using flag here
                await handleDeleteLogic(interaction, interaction.channel.id, interaction.user.id, true);
                break;
        }
    } catch (error) {
        console.error(`Error processing slash command /${interaction.commandName}:`, error);
        if (!interaction.replied && !interaction.deferred) {
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
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

        // 1. Show Modal for Media Applications
        if (ticketType === 'Apply for Media') {
            const modal = new ModalBuilder()
                .setCustomId('media_application_modal')
                .setTitle('Media Application Form');

            // FIX 1 (From previous step): Shortened label to be <= 45 characters 
            const linkInput = new TextInputBuilder()
                .setCustomId('platform_link')
                .setLabel('Link to Content Platform (YouTube, TikTok)') 
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g., youtube.com/@YourChannel')
                .setRequired(true);

            // FIX 2 (New Fix): Shortened label to be <= 45 characters (was 53 chars)
            const countInput = new TextInputBuilder()
                .setCustomId('follower_count')
                .setLabel('Follower/Subscriber Count (Number Only)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g., 5000')
                .setRequired(true);

            const planInput = new TextInputBuilder()
                .setCustomId('content_plan')
                .setLabel('Content plan for the server (Detailed description)')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            // Each TextInputBuilder MUST be wrapped in its own ActionRowBuilder for Modals
            modal.addComponents(
                new ActionRowBuilder().addComponents(linkInput),
                new ActionRowBuilder().addComponents(countInput),
                new ActionRowBuilder().addComponents(planInput)
            );

            // Attempt to show the modal (this was the critical failure point)
            return interaction.showModal(modal);
        }

        // 2. Direct Channel Creation for other types
        // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
        await interaction.deferReply({ flags: EPHEMERAL_FLAG });
        await createTicketChannel(interaction, ticketType);
    } catch (error) {
        // --- CRITICAL LOGGING ---
        console.error('❌ CRITICAL: Error during Select Menu (Modal Show) Interaction. Likely API rejection or component conflict. Full Error:', error);
        // --- END CRITICAL LOGGING ---
        
        let errorMessage = '❌ An error occurred trying to open the Media Application Form. This is often caused by a missing Discord bot permission (e.g., "Use Application Commands") or a transient issue. Please check the console logs for the specific error code.';

        // Try to reply to the failed interaction (which is difficult when it fails immediately)
        if (!interaction.replied && !interaction.deferred) {
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            await interaction.reply({ content: errorMessage, flags: EPHEMERAL_FLAG }).catch(e => console.error("Failed to reply to failed interaction:", e));
        } else {
             await interaction.editReply({ content: errorMessage, flags: EPHEMERAL_FLAG }).catch(e => console.error("Failed to edit reply to failed interaction:", e));
        }
    }
}

/**
 * Handles the submission of the Media Application Modal or Payout Modal.
 * @param {ModalSubmitInteraction} interaction
 */
async function handleModalSubmit(interaction) {
    // Defer the reply for channel creation/request handling
    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
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

            // If an error happens inside createTicketChannel, it will be caught here and logged.
            await createTicketChannel(interaction, 'Apply for Media', details);
        } else if (interaction.customId === 'payout_modal') {
            await handlePayoutRequest(interaction);
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
 * Handles staff payout request submission.
 * @param {ModalSubmitInteraction} interaction
 */
async function handlePayoutRequest(interaction) {
    // Reply already deferred in handleModalSubmit
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

        // --- IN-MEMORY BALANCE CHECK ---
        const balanceData = staffData.get(staffId);
        const currentBalance = balanceData ? balanceData.robux_balance : 0;
        // -------------------------------

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
             // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
             return interaction.editReply({ content: 'Ticket category not configured. Please contact an admin.', flags: EPHEMERAL_FLAG });
        }

        // --- IN-MEMORY OPEN TICKET CHECK ---
        const openTicketChannelId = Array.from(ticketLogs.values())
            .find(log => log.creator_id === user.id && log.end_time === null)?.channel_id;

        if (openTicketChannelId) {
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            return interaction.editReply({ content: `You already have an open ticket: <#${openTicketChannelId}>.`, flags: EPHEMERAL_FLAG });
        }
        // -----------------------------------


        // 1. Create Channel
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

        // 2. Store in In-Memory Map
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

        // 3. Send Initial Message with Buttons (UNCLAIMED, NOT SOFT-CLOSED)
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

        // Pin the initial message
        await initialMessage.pin();

        await interaction.editReply({ content: `✅ Your **${ticketType}** ticket has been created! Go to ${channel.toString()}` });

    } catch (error) {
        // Explicit error handling for permissions during channel creation
        if (error.code === 50013) {
             console.error('Channel Creation Failed: Missing Permissions (Manage Channels).');
             throw { code: 50013, message: 'Missing Discord permissions to create the channel.' };
        }
        console.error('Error creating ticket channel:', error);
        throw error;
    }
}


// --- Button Interaction Handler ---

/**
 * Handles all staff button interactions.
 * @param {ButtonInteraction} interaction
 */
async function handleButton(interaction) {
    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
    if (!interaction.inGuild()) return interaction.reply({ content: 'This action must be run in a server.', flags: EPHEMERAL_FLAG });

    const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    const customId = interaction.customId;
    
    // Defer the reply immediately to prevent the 3-second "Interaction Failed" error
    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
    await interaction.deferReply({ flags: EPHEMERAL_FLAG }).catch(e => console.error("Failed to defer reply:", e));

    try {
        if (customId.startsWith('ticket_')) {
            // Check for general staff access on all ticket buttons
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            if (!isStaff && customId !== 'ticket_admin_delete') return interaction.editReply({ content: 'You must be a staff member to perform ticket actions.', flags: EPHEMERAL_FLAG });

            const channelId = interaction.channel.id;
            const staffId = interaction.user.id;

            // --- IN-MEMORY TICKET LOG CHECK ---
            const ticketLog = getActiveTicketLog(channelId);
            
            // Allow ticket_admin_delete to run even if the ticket log is not found (for cleaning up old channels)
            if (!ticketLog && customId !== 'ticket_admin_delete') {
                // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                return interaction.editReply({ content: 'This channel is not an active ticket (or already finalized).', flags: EPHEMERAL_FLAG });
            }
            
            const { claimer_id, is_claimed, is_soft_closed } = ticketLog || {};
            const isCurrentClaimer = claimer_id === staffId;


            switch (customId) {
                case 'ticket_claim':
                case 'ticket_unclaim':
                    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                    if (is_soft_closed) return interaction.editReply({ content: 'Cannot change claim status on a soft-closed ticket.', flags: EPHEMERAL_FLAG });
                    await handleClaimUnclaimLogic(interaction, channelId, staffId, is_claimed, isCurrentClaimer, claimer_id);
                    break;

                case 'ticket_soft_close':
                    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                    if (!isCurrentClaimer && is_claimed) {
                        return interaction.editReply({ content: `❌ This ticket is claimed by <@${claimer_id}>. You must unclaim it or be the claimer to soft-close.`, flags: EPHEMERAL_FLAG });
                    }
                    await handleSoftCloseLogic(interaction, channelId, staffId, false);
                    break;

                case 'ticket_admin_delete':
                    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                    if (!isAdmin) return interaction.editReply({ content: 'Only Administrators can force delete tickets.', flags: EPHEMERAL_FLAG });
                    await handleDeleteLogic(interaction, channelId, staffId, false);
                    break;
                
                case 'ticket_finalize_delete':
                    // FIX: Allow all staff to finalize (since they completed the soft-close)
                    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                    if (!isStaff) return interaction.editReply({ content: 'You must be a staff member to finalize and delete tickets.', flags: EPHEMERAL_FLAG });
                    await handleDeleteLogic(interaction, channelId, staffId, false);
                    break;
            }
        } else if (customId.startsWith('payout_')) {
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            if (!isAdmin) return interaction.editReply({ content: 'Only Administrators can approve or deny payout requests.', flags: EPHEMERAL_FLAG });
            const [action, , staffId, amountStr] = customId.split('_');
            const args = [staffId, amountStr];
            await handlePayoutApproval(interaction, action, args);
        }
    } catch (error) {
        console.error(`❌ CRITICAL ERROR IN BUTTON HANDLER (${customId}) for channel ${interaction.channel.id}:`, error);
        await interaction.editReply({ 
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            content: `❌ A critical error occurred during this action. Please check the bot's console logs immediately. Error: \`${error.message}\``, 
            flags: EPHEMERAL_FLAG
        }).catch(() => console.error("Failed to send error reply to user."));
    }
}

// --- Claim/Unclaim Logic ---

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

    // Update global state
    claimedTickets.set(channelId, { claimerId, timeoutId });
}

client.on('messageCreate', async message => {
    if (!message.inGuild() || message.author.bot) return;

    const channelId = message.channel.id;
    const ticketInfo = claimedTickets.get(channelId);

    if (!ticketInfo) return; 

    // --- IN-MEMORY TICKET LOG CHECK ---
    const ticketLog = getActiveTicketLog(channelId);
    
    if (!ticketLog || ticketLog.is_soft_closed) {
        claimedTickets.delete(channelId); 
        return;
    }
    // -----------------------------------

    const creatorId = ticketLog.creator_id;
    const claimerId = ticketInfo.claimerId;

    // Case 1: Message is from the TICKET CREATOR -> START UNCLAIM TIMER
    if (message.author.id === creatorId) {
        startUnclaimTimer(message, claimerId);
    }

    // Case 2: Message is from the CLAIMED STAFF -> RESET TIMER (by setting timeoutId to null)
    if (message.author.id === claimerId) {
        if (ticketInfo?.timeoutId) {
            clearTimeout(ticketInfo.timeoutId);
            // Setting timeoutId to null prevents the timer from starting until the next user message
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

    // 1. Clear timeout from global state
    const ticketInfo = claimedTickets.get(channelId);
    if (ticketInfo?.timeoutId) clearTimeout(ticketInfo.timeoutId);
    claimedTickets.delete(channelId);

    // 2. Reset Permissions (restore send permissions for @Staff)
    try {
        // Ensure STAFF_ROLE_ID is valid before trying to edit permissions
        if (STAFF_ROLE_ID) {
            await channel.permissionOverwrites.edit(STAFF_ROLE_ID, { SendMessages: true });
        } else {
            console.error('STAFF_ROLE_ID is undefined or null. Cannot reset permissions.');
        }

        // 3. Update In-Memory Ticket Log
        const log = getActiveTicketLog(channelId);
        if (log) {
            log.is_claimed = false;
            log.claimer_id = null;
            ticketLogs.set(channelId, log);
        }

        // 4. Update Channel Topic (Remove claimer info)
        await channel.setTopic((channel.topic || '').replace(/🔒 Claimed by: .*$/i, ''));
        
        // 5. Update Buttons
        const initialMessage = await channel.messages.fetch(initialMessageId).catch(() => null);
        if (initialMessage) {
            const newRow = getTicketActionRow(false, log ? log.is_soft_closed : false); // isClaimed: false
            await initialMessage.edit({ components: [newRow] });
        }

    } catch (error) {
        console.error(`Error during unclaim/permission reset for ${channelId}:`, error);
        // Do not return here, we want to finish the unclaim process even if permission edit fails.
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
    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
    if (!log) return interaction.editReply({ content: 'Ticket log not found for this channel.', flags: EPHEMERAL_FLAG });

    if (isClaimed) {
        // UNCLAIM LOGIC
        if (isCurrentClaimer) {
            const initialMessageId = interaction.message.id;
            await unclaimTicket(interaction.guild, channelId, initialMessageId);
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            await interaction.editReply({ content: '✅ You have **unclaimed** this ticket. All staff can now respond.', flags: EPHEMERAL_FLAG });
            await channel.send(`🔓 <@${staffId}> has **unclaimed** this ticket. It is now available for any staff member.`);
        } else {
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            return interaction.editReply({ content: `❌ This ticket is claimed by <@${claimer_id}>. Only they can unclaim it.`, flags: EPHEMERAL_FLAG });
        }
    } else {
        // CLAIM LOGIC
        try {
            // 1. Claim the ticket (Update In-Memory Log)
            log.is_claimed = true;
            log.claimer_id = staffId;
            ticketLogs.set(channelId, log);

            // 2. Update Channel Topic & Permissions (Deny SendMessages for other staff)
            await channel.setTopic(`🔒 Claimed by: ${interaction.user.tag} (${staffId})`);
            
            // Check for valid STAFF_ROLE_ID before setting permission overwrites
            if (STAFF_ROLE_ID) {
                // Deny send messages permission for the general staff role
                await channel.permissionOverwrites.edit(STAFF_ROLE_ID, { SendMessages: false }); 
            } else {
                console.error('STAFF_ROLE_ID is undefined. Cannot deny send permissions for general staff role.');
            }
            
            // Explicitly allow send messages for the claiming staff member
            await channel.permissionOverwrites.edit(staffId, { SendMessages: true });

            // 3. Update global state (no timeout yet)
            claimedTickets.set(channelId, { claimerId: staffId, timeoutId: null });
            
            // 4. Update Buttons (Claim -> Unclaim)
            const newRow = getTicketActionRow(true, log.is_soft_closed); // isClaimed: true
            await interaction.message.edit({ components: [newRow] });

            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            await interaction.editReply({ content: '✅ You have **claimed** this ticket. Other staff members cannot type here until you unclaim it.', flags: EPHEMERAL_FLAG });
            await channel.send(`🔒 <@${staffId}> has **claimed** this ticket and is taking over.`);
        } catch (error) {
            console.error('Error during Claim logic:', error);
            // Rollback in-memory state on critical failure
            log.is_claimed = false;
            log.claimer_id = null;
            ticketLogs.set(channelId, log);
            
            // Check if the error is a permission issue
            if (error.code === 50013) {
                return interaction.editReply({ 
                    // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                    content: '❌ Claim Failed: The bot is missing permissions to **edit channel permissions** (Manage Roles) or **edit the initial ticket message**.', 
                    flags: EPHEMERAL_FLAG
                });
            }
            throw error; // Re-throw to be caught by the general handler
        }
    }
}


// --- Soft Close (Robux Add) Logic ---

/**
 * Handles the soft close action (adds Robux, locks channel, updates buttons to Delete).
 * @param {Interaction} interaction - The button/slash command interaction.
 * @param {string} channelId
 * @param {string} staffId
 * @param {boolean} isSlashCommand - True if triggered by /close-ticket.
 */
async function handleSoftCloseLogic(interaction, channelId, staffId, isSlashCommand) {
    // --- IN-MEMORY TICKET LOG CHECK ---
    const log = getActiveTicketLog(channelId);

    if (!log) {
        // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
        return interaction.editReply({ content: 'This channel is not an active ticket (or already finalized).', flags: EPHEMERAL_FLAG });
    }

    const { creator_id, ticket_type, is_soft_closed } = log;

    if (is_soft_closed) {
        // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
        return interaction.editReply({ content: 'This ticket is already soft-closed. Use the **Finalize & Delete** button to complete the process.', flags: EPHEMERAL_FLAG });
    }
    
    try {
        // 1. Unclaim just in case and remove from cache
        if (claimedTickets.has(channelId)) {
            const initialMessageId = interaction.message ? interaction.message.id : (await interaction.channel.messages.fetchPinned()).first()?.id;
            if (initialMessageId) {
                await unclaimTicket(interaction.guild, channelId, initialMessageId);
            }
        }
        
        const robuxValue = PAYOUT_VALUES[ticket_type] || 0;

        // 2. Add Robux and Log Close (Update In-Memory Log)
        log.is_soft_closed = true;
        ticketLogs.set(channelId, log); // Store updated log

        const newBalance = updateRobuxBalance(staffId, robuxValue);

        // 3. Update Buttons (Close -> Finalize & Delete)
        const initialMessage = interaction.message || (await interaction.channel.messages.fetchPinned()).first();

        if (initialMessage) {
            const newRow = getTicketActionRow(false, true); // isClaimed: false, isSoftClosed: true
            await initialMessage.edit({
                content: `**Ticket Soft-Closed by ${interaction.user.tag}** | Ready for final deletion.`,
                components: [newRow]
            }).catch(e => console.error("Error editing initial message for soft close:", e));
        }
        
        // 4. Lock permissions (deny creator and staff send access)
        if (creator_id) {
             await interaction.channel.permissionOverwrites.edit(creator_id, { SendMessages: false });
        }
        if (STAFF_ROLE_ID) {
             await interaction.channel.permissionOverwrites.edit(STAFF_ROLE_ID, { SendMessages: false });
        } else {
             console.warn('STAFF_ROLE_ID is missing. Cannot lock general staff sending messages.');
        }


        // 5. Send confirmation
        const replyContent = `✅ Ticket soft-closed. **${robuxValue} R$** added to your balance (New Balance: **${newBalance} R$**). The channel is now locked. Use **Finalize & Delete** to remove the channel.`;
        
        if (isSlashCommand) {
            await interaction.editReply({ content: replyContent });
        } else {
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            await interaction.editReply({ content: replyContent, flags: EPHEMERAL_FLAG });
            await interaction.channel.send(`💾 <@${staffId}> has **soft-closed** this ticket. It is now locked and awaiting final deletion.`);
        }
    } catch (error) {
        console.error('Error during Soft Close logic:', error);
        
        // Rollback state on failure
        log.is_soft_closed = false;
        ticketLogs.set(channelId, log);
        updateRobuxBalance(staffId, -PAYOUT_VALUES[ticket_type] || 0);
        
        if (error.code === 50013) {
            return interaction.editReply({ 
                // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                content: '❌ Soft Close Failed: The bot is missing permissions to **edit channel permissions** (Manage Roles) or **edit the initial ticket message**.', 
                flags: EPHEMERAL_FLAG
            });
        }
        throw error; // Re-throw to be caught by the general handler
    }
}

// --- Hard Delete (Transcript + Delete Channel) Logic ---

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
    
    // --- IN-MEMORY TICKET LOG CHECK ---
    const log = getActiveTicketLog(channelId) || { creator_id: 'Unknown', ticket_type: 'Unknown Ticket', is_soft_closed: isFinalizeDelete }; // Fallback for admin delete
    
    // Check if the ticket should be soft-closed first (only applies to Finalize & Delete button)
    if (isFinalizeDelete && !log.is_soft_closed) {
        // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
        return interaction.editReply({ content: 'This ticket must be soft-closed first (which adds Robux) before finalizing the delete process.', flags: EPHEMERAL_FLAG });
    }
    
    try {
        // 1. Clean up cache
        claimedTickets.delete(channelId);

        // 2. Fetch all messages for transcript
        const creator = await interaction.guild.members.fetch(log.creator_id).catch(() => ({ user: { tag: 'Unknown User' } }));
        // FIX: Discord API limit is 100 messages per fetch.
        const messages = await channel.messages.fetch({ limit: 100 }); 
        const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const htmlContent = generateHtmlTranscript(sortedMessages, creator);

        const logChannel = client.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
        let transcriptUrl = 'URL not available.';
        
        if (logChannel) {
            // 3. Upload Transcript
            const attachment = new AttachmentBuilder(Buffer.from(htmlContent), { name: `transcript-${channel.name}-${Date.now()}.html` });
            const logMessage = await logChannel.send({
                content: `**TICKET DELETED & LOGGED**\nCreator: <@${log.creator_id}> (${creator.user.tag})\nType: ${log.ticket_type}\nStaff Finalizer: <@${interaction.user.id}>`,
                files: [attachment]
            });

            // 4. Extract Hosted Link 
            transcriptUrl = logMessage.attachments.first()?.url || 'URL not available.';

            // Add Direct Link Button
            const linkRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Direct Link').setStyle(ButtonStyle.Link).setURL(transcriptUrl)
            );
            await logMessage.edit({ components: [linkRow] });

            // 5. Update In-Memory Log (Finalize end_time and link. This marks the ticket as officially closed)
            log.html_transcript_link = transcriptUrl;
            log.end_time = new Date();
            ticketLogs.set(channelId, log); // Store finalized log
        } else {
            console.error(`TRANSCRIPT_LOG_CHANNEL_ID: ${TRANSCRIPT_LOG_CHANNEL_ID} not found. Deleting ticket without logging.`);
            // If log channel is missing, still mark as deleted in memory
            log.end_time = new Date();
            ticketLogs.set(channelId, log);
        }

        // 6. Send final confirmation
        const finalReply = `✅ Ticket finalized and deleted. Transcript saved to logs (if configured). Channel will be deleted in 5 seconds.`;
        
        if (isSlashCommand) {
            await interaction.editReply({ content: finalReply });
        } else {
            // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
            await interaction.editReply({ content: finalReply, flags: EPHEMERAL_FLAG });
        }

        // 7. Delete Channel
        setTimeout(() => {
            channel.delete('Ticket finalized and deleted by staff.').catch(err => console.error('Error deleting channel (requires Manage Channels permission):', err));
            ticketLogs.delete(channelId); // Clean up the map after deletion
        }, 5000);
    } catch (error) {
         console.error('Error during Hard Delete logic:', error);
         if (error.code === 50013) {
            return interaction.editReply({ 
                // FIX: Replaced ephemeral: true with flags: EPHEMERAL_FLAG
                content: '❌ Delete Failed: The bot is missing permissions to **delete the channel** (Manage Channels) or **send messages in the Transcript Log Channel**.', 
                flags: EPHEMERAL_FLAG
            });
        }
        throw error; // Re-throw to be caught by the general handler
    }
}


// --- Payout Approval Logic ---

/**
 * Handles the approval or denial of a Robux payout request.
 * @param {ButtonInteraction} interaction
 * @param {string} action 'payout_approve' or 'payout_deny'.
 * @param {string[]} args Array containing [staffId, amount].
 */
async function handlePayoutApproval(interaction, action, args) {
    // Reply already deferred in handleButton
    const [staffId, amountStr] = args;
    const amount = parseInt(amountStr);
    const approverId = interaction.user.id;
    const isApproval = action === 'payout_approve';

    try {
        // Disable buttons immediately to prevent double-processing
        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('approved').setLabel(isApproval ? '✅ Approved' : '❌ Denied').setStyle(isApproval ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(true)
        );
        await interaction.message.edit({ components: [disabledRow] });

        if (!isApproval) {
            try {
                const staffMember = await client.users.fetch(staffId);
                await staffMember.send(`❌ Your Robux payout request for **${amount} R$** has been **denied** by <@${approverId}>. Please contact them for details.`);
                return interaction.editReply({ content: `❌ Successfully denied payout request for <@${staffId}>.` });
            } catch (error) {
                console.error('Error denying payout:', error);
                return interaction.editReply({ content: `❌ Denied, but could not DM staff member <@${staffId}>.` });
            }
        }

        // Approval Logic
        // --- IN-MEMORY BALANCE CHECK ---
        const balanceData = staffData.get(staffId);
        const currentBalance = balanceData ? balanceData.robux_balance : 0;
        // -------------------------------

        if (currentBalance < amount) {
            return interaction.editReply({ content: `⚠️ Cannot approve. Staff member's balance (**${currentBalance} R$**) is now less than the requested amount (**${amount} R$**). Request rejected.` });
        }

        // 2. Reset Balance (using negative amount in updateRobuxBalance)
        updateRobuxBalance(staffId, -amount);

        // 3. Log the successful transaction (In-Memory)
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

        // 4. Notify Staff Member
        const staffMember = await client.users.fetch(staffId);
        await staffMember.send(
            `✅ Your Robux payout request for **${amount} R$** has been **approved** by <@${approverId}>! Your balance has been reset to **0 R$**.\n\nPlease ensure your **Roblox Gamepass** is correctly configured to receive the payment shortly.`
        );

        // 5. Final Confirmation
        await interaction.editReply({ content: `✅ Payout of **${amount} R$** to <@${staffId}> approved and logged. Staff notified. Balance reset to 0.` });

    } catch (error) {
        console.error('Error during payout approval:', error);
        
        // CRITICAL: Rollback balance if transaction fails mid-process (approval attempt was made)
        if (isApproval) {
            updateRobuxBalance(staffId, amount); 
        }
        
        throw error; // Re-throw to be caught by the general handler
    }
}

// Start the bot
client.login(DISCORD_TOKEN);
