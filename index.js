// Discord Ticket System Bot - Built for Railway.app with PostgreSQL
// Requires 'discord.js' and 'pg' packages.

const {
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
    SelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
    TextInputStyle, ChannelType, PermissionsBitField, AttachmentBuilder,
    Collection
} = require('discord.js');
const { Client: PgClient } = require('pg');

// --- Configuration from Environment Variables ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const POSTGRES_URL = process.env.POSTGRES_URL; // Railway provides this
const GUILD_ID = process.env.GUILD_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID; // Used for payout approvals
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

// --- Global State & Cache ---
// Cache for managing claimed ticket state (since Node.js is single-process)
// Key: channelId, Value: { claimerId: string, timeoutId: NodeJS.Timeout | null }
const claimedTickets = new Collection();

// --- Database Setup ---
const db = new PgClient({
    connectionString: POSTGRES_URL,
    ssl: { rejectUnauthorized: false } // Required for external SSL connection (like Railway)
});

/**
 * Connects to the database and ensures all required tables exist.
 */
async function initializeDatabase() {
    try {
        await db.connect();
        console.log('PostgreSQL Connected!');

        // 1. Staff Data Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS staff_data (
                user_id VARCHAR(255) PRIMARY KEY,
                robux_balance INTEGER DEFAULT 0
            );
        `);

        // 2. Ticket Logs Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS ticket_logs (
                ticket_id SERIAL PRIMARY KEY,
                channel_id VARCHAR(255) UNIQUE NOT NULL,
                creator_id VARCHAR(255) NOT NULL,
                ticket_type VARCHAR(50) NOT NULL,
                start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMP WITH TIME ZONE,
                claimer_id VARCHAR(255),
                is_claimed BOOLEAN DEFAULT FALSE
            );
        `);

        // 3. Transaction Logs Table
        await db.query(`
            CREATE TABLE IF NOT EXISTS transaction_logs (
                transaction_id SERIAL PRIMARY KEY,
                staff_id VARCHAR(255) NOT NULL REFERENCES staff_data(user_id),
                amount_paid INTEGER NOT NULL,
                transaction_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                gamepass_link TEXT NOT NULL,
                admin_approver_id VARCHAR(255)
            );
        `);

        // 4. Pending Reward Requests Table (New for Bug 2 Fix)
        await db.query(`
            CREATE TABLE IF NOT EXISTS pending_rewards (
                request_id SERIAL PRIMARY KEY,
                channel_id VARCHAR(255) UNIQUE NOT NULL,
                staff_id VARCHAR(255) NOT NULL,
                amount INTEGER NOT NULL,
                request_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('Database tables verified/created successfully.');
    } catch (error) {
        console.error('Failed to initialize database:', error.message);
        // Exit process if DB connection fails as the bot is non-functional without it.
        process.exit(1);
    }
}

/**
 * Updates a staff member's Robux balance. Creates the user record if it doesn't exist.
 * @param {string} userId The ID of the staff member.
 * @param {number} amount The amount to add (can be negative for payout reset).
 */
async function updateRobuxBalance(userId, amount) {
    try {
        const query = `
            INSERT INTO staff_data (user_id, robux_balance)
            VALUES ($1, $2)
            ON CONFLICT (user_id)
            DO UPDATE SET robux_balance = staff_data.robux_balance + $2
            RETURNING robux_balance;
        `;
        const result = await db.query(query, [userId, amount]);
        return result.rows[0].robux_balance;
    } catch (error) {
        console.error(`Error updating Robux balance for ${userId}:`, error.message);
        return null;
    }
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

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    await initializeDatabase();
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
            name: 'setup-panel',
            description: 'ADMIN ONLY: Deploys the persistent ticket panel.',
            default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
        }
    ];

    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (guild) {
            await guild.commands.set(commands);
            console.log('Slash commands registered.');
        } else {
            console.warn(`Guild with ID ${GUILD_ID} not found. Skipping command registration.`);
        }
    } catch (error) {
        console.error('Error registering slash commands:', error);
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

    const selectMenu = new SelectMenuBuilder()
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

    const { embed, row } = createTicketPanel();

    // Check if a panel already exists (optional: look up last message sent by bot)
    // For simplicity, we just send a new one. A dedicated /setup command handles this better.

    console.log('Ticket panel generated. Use /setup-panel to deploy it.');
}

// --- Transcript and Logging Helper ---

/**
 * Generates a simple, Discord-styled HTML transcript of a channel's messages.
 * NOTE: This is a simplified version. A production bot would use a dedicated library
 * like discord-html-transcripts for accurate styling.
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
                <div class="header">
                    <span class="username" style="color: ${usernameColor};">${msg.author.username}</span>
                    ${botTag}
                    <span style="float: right; font-size: 12px;">${timestamp}</span>
                </div>
                <div class="content">${msg.content.replace(/\n/g, '<br>')}</div>
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
    } else if (interaction.isSelectMenu()) {
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
    if (!interaction.inGuild()) return interaction.reply({ content: 'This command must be run in a server.', ephemeral: true });

    // Check if the user has the Staff role for the two main commands
    const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);

    switch (interaction.commandName) {
        case 'setup-panel':
            // Check for Administrator permission
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'You need Administrator permissions to set up the panel.', ephemeral: true });
            }
            const { embed, row } = createTicketPanel();
            await interaction.channel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: 'Ticket panel deployed successfully.', ephemeral: true });
            break;

        case 'check-robux':
            if (!isStaff) return interaction.reply({ content: 'You must be a staff member to use this command.', ephemeral: true });

            try {
                const result = await db.query('SELECT robux_balance FROM staff_data WHERE user_id = $1', [interaction.user.id]);
                const balance = result.rows.length > 0 ? result.rows[0].robux_balance : 0;

                const embed = new EmbedBuilder()
                    .setTitle('💰 Robux Payout Balance')
                    .setColor('#FFC0CB') // Pink/Payout Color
                    .setDescription(`
                        Your current earned balance is **${balance} R$**.
                        ---
                        **Payout Rules:**
                        - **Min Request:** ${PAYOUT_MIN} R$
                        - **Max Request:** ${PAYOUT_MAX} R$
                        - Use \`/payout\` when you are ready to request a payment.
                    `);
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                console.error('Error checking balance:', error);
                await interaction.reply({ content: 'An error occurred while fetching your balance.', ephemeral: true });
            }
            break;

        case 'payout':
            if (!isStaff) return interaction.reply({ content: 'You must be a staff member to use this command.', ephemeral: true });

            const modal = new ModalBuilder()
                .setCustomId('payout_modal')
                .setTitle('Robux Payout Request');

            const gamepassInput = new TextInputBuilder()
                .setCustomId('gamepass_link')
                .setLabel('Roblox Gamepass Link')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://www.roblox.com/game-pass/...')
                .setRequired(true);

            const amountInput = new TextInputBuilder()
                .setCustomId('payout_amount')
                .setLabel('Requested Robux Amount (R$)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(`Between ${PAYOUT_MIN} and ${PAYOUT_MAX}`)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(amountInput),
                new ActionRowBuilder().addComponents(gamepassInput)
            );

            await interaction.showModal(modal);
            break;
    }
}

/**
 * Handles the selection from the ticket panel dropdown.
 * @param {SelectMenuInteraction} interaction
 */
async function handleSelectMenu(interaction) {
    if (interaction.customId !== 'select_ticket_type') return;

    const ticketType = interaction.values[0];

    // 1. Show Modal for Media Applications
    if (ticketType === 'Apply for Media') {
        const modal = new ModalBuilder()
            .setCustomId('media_application_modal')
            .setTitle('Media Application Form');

        const linkInput = new TextInputBuilder()
            .setCustomId('platform_link')
            .setLabel('Link to main content platform ')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., youtube.com/@YourChannel')
            .setRequired(true);

        const countInput = new TextInputBuilder()
            .setCustomId('follower_count')
            .setLabel('Current follower/subscriber count (Number only)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., 5000')
            .setRequired(true);

        const planInput = new TextInputBuilder()
            .setCustomId('content_plan')
            .setLabel('Content plan for server (Detailed description)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(linkInput),
            new ActionRowBuilder().addComponents(countInput),
            new ActionRowBuilder().addComponents(planInput)
        );

        return interaction.showModal(modal);
    }

    // 2. Direct Channel Creation for other types
    await interaction.deferReply({ ephemeral: true });
    await createTicketChannel(interaction, ticketType);
}

/**
 * Handles the submission of the Media Application Modal.
 * @param {ModalSubmitInteraction} interaction
 */
async function handleModalSubmit(interaction) {
    if (interaction.customId === 'media_application_modal') {
        await interaction.deferReply({ ephemeral: true });
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
}

/**
 * Handles staff payout request submission.
 * @param {ModalSubmitInteraction} interaction
 */
async function handlePayoutRequest(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const amountStr = interaction.fields.getTextInputValue('payout_amount');
    const gamepassLink = interaction.fields.getTextInputValue('gamepass_link');
    const staffId = interaction.user.id;

    const amount = parseInt(amountStr);

    if (isNaN(amount) || amount < PAYOUT_MIN || amount > PAYOUT_MAX) {
        return interaction.editReply({
            content: `❌ Invalid amount. You must request between ${PAYOUT_MIN} R$ and ${PAYOUT_MAX} R$.`
        });
    }

    try {
        // 1. Check current balance
        const balanceResult = await db.query('SELECT robux_balance FROM staff_data WHERE user_id = $1', [staffId]);
        const currentBalance = balanceResult.rows.length > 0 ? balanceResult.rows[0].robux_balance : 0;

        if (amount > currentBalance) {
            return interaction.editReply({
                content: `❌ Your current balance is only **${currentBalance} R$**. You cannot request **${amount} R$**.`
            });
        }

        // 2. Send to Admin Approval Channel
        const approvalChannel = client.channels.cache.get(ADMIN_APPROVAL_CHANNEL_ID);
        if (!approvalChannel) return interaction.editReply({ content: 'An internal error occurred: Approval channel not found.' });

        // Use a unique ID for the payout request
        const payoutRequestId = `${staffId}-${Date.now()}`;

        const approvalEmbed = new EmbedBuilder()
            .setTitle('💵 NEW ROBux PAYOUT REQUEST')
            .setColor('#FFA500') // Orange/Alert Color
            .addFields(
                { name: 'Staff Member', value: interaction.user.tag, inline: true },
                { name: 'Requested Amount', value: `**${amount} R$**`, inline: true },
                { name: 'Gamepass Link', value: gamepassLink },
                { name: 'Staff ID', value: staffId },
                { name: 'Request ID', value: payoutRequestId }
            )
            .setTimestamp();

        // The button custom IDs contain the unique Request ID
        const approveButton = new ButtonBuilder()
            .setCustomId(`payout_approve_${payoutRequestId}_${staffId}_${amount}`)
            .setLabel('✅ Approve Payout')
            .setStyle(ButtonStyle.Success);

        const denyButton = new ButtonBuilder()
            .setCustomId(`payout_deny_${payoutRequestId}_${staffId}_${amount}`)
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
        await interaction.editReply({ content: 'An error occurred during the payout request process.' });
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
            return interaction.editReply({ content: 'Ticket category not configured. Please contact an admin.', ephemeral: true });
        }

        // Check for existing open ticket by this user (prevent spam)
        const openTicket = await db.query('SELECT channel_id FROM ticket_logs WHERE creator_id = $1 AND end_time IS NULL', [user.id]);
        if (openTicket.rows.length > 0) {
            const channelId = openTicket.rows[0].channel_id;
            return interaction.editReply({ content: `You already have an open ticket: <#${channelId}>.`, ephemeral: true });
        }


        // 1. Create Channel
        const channel = await guild.channels.create({
            name: `${ticketType.toLowerCase().replace(/\s/g, '-')}-${user.username.toLowerCase()}`,
            type: ChannelType.GuildText,
            parent: ticketCategory,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: user.id, // Ticket Creator
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: STAFF_ROLE_ID, // Staff Role
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: ADMIN_ROLE_ID, // Admin Role
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                }
            ],
        });

        // 2. Store in Database
        await db.query(
            'INSERT INTO ticket_logs (channel_id, creator_id, ticket_type) VALUES ($1, $2, $3)',
            [channel.id, user.id, ticketType]
        );

        // 3. Send Initial Message with Buttons
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Primary).setEmoji('🔒'),
            // Replaced 'close_ticket' with 'request_reward' for soft-close workflow (Fix for Bug 2)
            new ButtonBuilder().setCustomId('request_reward').setLabel('Close (Request Reward)').setStyle(ButtonStyle.Secondary).setEmoji('💸'),
            new ButtonBuilder().setCustomId('delete_ticket').setLabel('Finalize & Delete').setStyle(ButtonStyle.Danger).setEmoji('❌'),
        );

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
        console.error('Error creating ticket channel:', error);
        await interaction.editReply({ content: 'An unexpected error occurred while creating your ticket. Please try again later.' });
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
 * Handles all staff button interactions (Claim, Reward Request, Delete, Payout Approval).
 * @param {ButtonInteraction} interaction
 */
async function handleButton(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: 'This action must be run in a server.', ephemeral: true });

    // Check staff permissions for ticket action buttons
    const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    const [action, ...args] = interaction.customId.split('_');

    if (['claim', 'request', 'delete'].includes(action)) {
        if (!isStaff) return interaction.reply({ content: 'You must be a staff member to perform this action.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
    }

    if (action === 'claim') {
        return handleClaim(interaction);
    } else if (action === 'request') {
        // Handle 'request_reward' soft-close button
        if (args[0] === 'reward') {
            return handleRewardRequest(interaction);
        }
    } else if (action === 'delete') {
        if (!isAdmin) return interaction.editReply({ content: 'Only Administrators can finalize and delete tickets.', ephemeral: true });
        return handleDelete(interaction);
    } else if (action === 'payout') {
        // Fix for Bug 1: Correctly parse the action for Payouts
        if (!isAdmin) return interaction.reply({ content: 'Only Administrators can approve or deny payout requests.', ephemeral: true });
        const specificAction = interaction.customId.split('_')[1]; // 'approve' or 'deny'
        const remainingArgs = interaction.customId.split('_').slice(2); // [payoutRequestId, staffId, amount]
        return handlePayoutApproval(interaction, specificAction, remainingArgs);
    } else if (action === 'reward') {
        // New handler for reward approval buttons (Fix for Bug 2)
        if (!isAdmin) return interaction.reply({ content: 'Only Administrators can approve or deny rewards.', ephemeral: true });
        const specificAction = interaction.customId.split('_')[1]; // 'approve' or 'deny'
        const channelId = args[0]; // Channel ID is the first arg
        await interaction.deferReply({ ephemeral: true });
        return handleRewardApproval(interaction, specificAction, channelId);
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

    // Clear any existing timeout
    const existingTicket = claimedTickets.get(channelId);
    if (existingTicket?.timeoutId) {
        clearTimeout(existingTicket.timeoutId);
    }

    const timeoutId = setTimeout(async () => {
        const ticketInfo = claimedTickets.get(channelId);
        if (!ticketInfo || ticketInfo.claimerId !== claimerId) return; // Claim changed or was already unclaimed

        await unclaimTicket(guild, channelId, true);
        message.channel.send(`⚠️ <@${claimerId}> did not reply within 20 minutes of the user's message. The ticket has been **automatically unclaimed**. All staff can now respond.`);
    }, UNCLAIM_TIMEOUT_MS);

    // Update global state
    claimedTickets.set(channelId, { claimerId, timeoutId });
}

/**
 * Unclaims a ticket, resetting permissions and database state.
 * @param {Guild} guild The guild object.
 * @param {string} channelId The channel ID to unclaim.
 * @param {boolean} isTimeout If the unclaim was due to timeout.
 */
async function unclaimTicket(guild, channelId, isTimeout = false) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    // 1. Clear timeout from global state
    const ticketInfo = claimedTickets.get(channelId);
    if (ticketInfo?.timeoutId) clearTimeout(ticketInfo.timeoutId);
    claimedTickets.delete(channelId);

    // 2. Reset Permissions (restore send permissions for @Staff)
    try {
        await channel.permissionOverwrites.edit(STAFF_ROLE_ID, {
            SendMessages: true,
        });

        // 3. Update DB
        // Only update if it's still considered an active ticket (not soft-closed)
        const activeCheck = await db.query('SELECT 1 FROM ticket_logs WHERE channel_id = $1 AND end_time IS NULL', [channelId]);
        if (activeCheck.rows.length > 0) {
            await db.query(
                'UPDATE ticket_logs SET is_claimed = FALSE, claimer_id = NULL WHERE channel_id = $1 AND end_time IS NULL',
                [channelId]
            );
        }

        // 4. Update Channel Topic
        const topic = channel.topic || '';
        if (topic.includes('🔒 Claimed by:')) {
             await channel.setTopic(topic.replace(/🔒 Claimed by: .*$/i, ''));
        }


    } catch (error) {
        console.error(`Error during unclaim/permission reset for ${channelId}:`, error);
    }
}

client.on('messageCreate', async message => {
    if (!message.inGuild() || message.author.bot) return;

    const channelId = message.channel.id;
    const ticketInfo = claimedTickets.get(channelId);

    if (!ticketInfo) return; // Not a claimed ticket

    const ticketLog = await db.query('SELECT creator_id FROM ticket_logs WHERE channel_id = $1 AND end_time IS NULL', [channelId]);
    if (ticketLog.rows.length === 0) {
        claimedTickets.delete(channelId); // Cleanup dead cache entry
        return;
    }

    const creatorId = ticketLog.rows[0].creator_id;
    const claimerId = ticketInfo.claimerId;

    // Case 1: Message is from the TICKET CREATOR -> START UNCLAIM TIMER
    if (message.author.id === creatorId) {
        startUnclaimTimer(message, claimerId);
    }

    // Case 2: Message is from the CLAIMED STAFF -> RESET TIMER (if it exists)
    if (message.author.id === claimerId) {
        if (ticketInfo?.timeoutId) {
            clearTimeout(ticketInfo.timeoutId);
            // Re-arm the timer only if a subsequent user message comes in.
            // For now, setting it to null signals it was reset by the claimer's message.
            claimedTickets.set(channelId, { claimerId: claimerId, timeoutId: null });
        }
    }
});


/**
 * Handles the 'Claim' button press.
 * @param {ButtonInteraction} interaction
 */
async function handleClaim(interaction) {
    const channel = interaction.channel;
    const claimerId = interaction.user.id;

    const ticketCheck = await db.query('SELECT is_claimed, claimer_id, ticket_type FROM ticket_logs WHERE channel_id = $1 AND end_time IS NULL', [channel.id]);

    if (ticketCheck.rows.length === 0) {
        return interaction.editReply({ content: 'This channel is not an active ticket (it may be soft-closed or deleted).', ephemeral: true });
    }

    const { is_claimed, claimer_id, ticket_type } = ticketCheck.rows[0];

    if (is_claimed) {
        // Unclaim if it's the current claimer, otherwise reject
        if (claimer_id === claimerId) {
            await unclaimTicket(interaction.guild, channel.id, false);
            return interaction.editReply({ content: '✅ You have **unclaimed** this ticket. All staff can now respond.', ephemeral: true });
        } else {
            return interaction.editReply({ content: `❌ This ticket is already claimed by <@${claimer_id}>.`, ephemeral: true });
        }
    }

    // 1. Claim the ticket
    await db.query(
        'UPDATE ticket_logs SET is_claimed = TRUE, claimer_id = $1 WHERE channel_id = $2 AND end_time IS NULL',
        [claimerId, channel.id]
    );

    // 2. Update Channel Topic & Permissions (Deny SendMessages for other staff)
    await channel.setTopic(`🔒 Claimed by: ${interaction.user.tag} (${claimerId}) | Type: ${ticket_type}`);

    // Deny typing permission for ALL staff *except* Admins and the Claimer
    const staffRole = channel.guild.roles.cache.get(STAFF_ROLE_ID);
    if (staffRole) {
        await channel.permissionOverwrites.edit(STAFF_ROLE_ID, { SendMessages: false });
    }
    // Grant back SendMessages to the claiming staff member (though they should have it from the initial deny)
    await channel.permissionOverwrites.edit(claimerId, { SendMessages: true });

    // 3. Update global state
    claimedTickets.set(channel.id, { claimerId, timeoutId: null });

    await interaction.editReply({ content: '✅ You have **claimed** this ticket. Other staff members cannot type here until you unclaim it.', ephemeral: true });
    await channel.send(`🔒 <@${claimerId}> has **claimed** this ticket and is taking over.`);
}


// --- Lifecycle Handlers (Reward Request / Delete) ---

/**
 * Handles the 'request_reward' button press (soft-closes ticket and locks channel).
 * This replaces the old 'handleClose' (Fix for Bug 2).
 * @param {ButtonInteraction} interaction
 */
async function handleRewardRequest(interaction) {
    const channel = interaction.channel;
    const ticketLogResult = await db.query('SELECT creator_id, ticket_type, claimer_id FROM ticket_logs WHERE channel_id = $1 AND end_time IS NULL', [channel.id]);

    if (ticketLogResult.rows.length === 0) {
        return interaction.editReply({ content: 'This channel is not an active ticket.', ephemeral: true });
    }

    const { creator_id, ticket_type, claimer_id } = ticketLogResult.rows[0];

    if (claimer_id !== interaction.user.id) {
        return interaction.editReply({ content: 'You must claim the ticket first to request a reward payout.', ephemeral: true });
    }

    const robuxValue = PAYOUT_VALUES[ticket_type] || 0;

    // 1. Unclaim just in case
    await unclaimTicket(interaction.guild, interaction.channel.id);

    // 2. Lock permissions (deny creator and staff send access)
    await interaction.channel.permissionOverwrites.edit(creator_id, { SendMessages: false });
    await interaction.channel.permissionOverwrites.edit(STAFF_ROLE_ID, { SendMessages: false });

    // 3. Store the reward request in the new table
    await db.query(
        'INSERT INTO pending_rewards (channel_id, staff_id, amount) VALUES ($1, $2, $3) ON CONFLICT (channel_id) DO NOTHING',
        [channel.id, claimer_id, robuxValue]
    );

    // 4. Send to Admin Approval Channel (Fix for Bug 2)
    const approvalChannel = client.channels.cache.get(ADMIN_APPROVAL_CHANNEL_ID);
    if (!approvalChannel) return interaction.editReply({ content: 'An internal error occurred: Approval channel not found.' });

    const approvalEmbed = new EmbedBuilder()
        .setTitle('💸 NEW TICKET REWARD REQUEST')
        .setColor('#1ABC9C') // Teal/Success Color
        .addFields(
            { name: 'Ticket Channel', value: `<#${channel.id}>`, inline: true },
            { name: 'Staff Member', value: interaction.user.tag, inline: true },
            { name: 'Reward Amount', value: `**${robuxValue} R$**`, inline: false },
            { name: 'Ticket Type', value: ticket_type },
            { name: 'Original Creator ID', value: creator_id }
        )
        .setTimestamp();

    const approveButton = new ButtonBuilder()
        .setCustomId(`reward_approve_${channel.id}`) // Use Channel ID as key
        .setLabel('✅ Approve Reward')
        .setStyle(ButtonStyle.Success);

    const denyButton = new ButtonBuilder()
        .setCustomId(`reward_deny_${channel.id}`) // Use Channel ID as key
        .setLabel('❌ Deny Reward')
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(approveButton, denyButton);

    await approvalChannel.send({
        content: `<@&${ADMIN_ROLE_ID}> New reward request to review!`,
        embeds: [approvalEmbed],
        components: [row]
    });


    // 5. Update Message and Disable Buttons in ticket channel
    const initialMessage = await interaction.message.fetch(interaction.message.id);
    const softClosedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claimed_soft').setLabel('Claimed').setStyle(ButtonStyle.Primary).setDisabled(true).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('reward_pending').setLabel('Reward Pending').setStyle(ButtonStyle.Secondary).setDisabled(true).setEmoji('⏳'),
        new ButtonBuilder().setCustomId('delete_ticket').setLabel('Finalize & Delete').setStyle(ButtonStyle.Danger).setEmoji('❌'),
    );

    await initialMessage.edit({ components: [softClosedRow] });

    // 6. Send confirmation
    await interaction.editReply({
        content: `✅ Ticket soft-closed. A reward request for **${robuxValue} R$** has been sent for Admin approval. The channel is now locked. Use **Finalize & Delete** to remove the channel after approval.`,
        ephemeral: true
    });
}

/**
 * Handles the 'reward_approve' or 'reward_deny' button press (Fix for Bug 2).
 * @param {ButtonInteraction} interaction
 * @param {string} specificAction 'approve' or 'deny'.
 * @param {string} channelId The ID of the original ticket channel.
 */
async function handleRewardApproval(interaction, specificAction, channelId) {
    // 1. Check if a pending request exists (The core fix for Bug 2's validation error)
    const requestResult = await db.query('SELECT staff_id, amount FROM pending_rewards WHERE channel_id = $1', [channelId]);

    if (requestResult.rows.length === 0) {
        // If the request is not found (already processed/deleted)
        return interaction.editReply({ content: '❌ Error: This channel is not tied to a pending reward request (or it has already been processed).', ephemeral: true });
    }

    const { staff_id, amount } = requestResult.rows[0];
    const staffMember = await client.users.fetch(staff_id).catch(() => null);

    // Disable buttons immediately
    const label = specificAction === 'approve' ? '✅ Approved' : '❌ Denied';
    const style = specificAction === 'approve' ? ButtonStyle.Success : ButtonStyle.Danger;
    const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('processed').setLabel(label).setStyle(style).setDisabled(true)
    );
    await interaction.message.edit({ components: [disabledRow] });


    if (specificAction === 'approve') {
        try {
            // 2. Add Robux to staff balance
            const newBalance = await updateRobuxBalance(staff_id, amount);

            // 3. Update main ticket log (soft-closed tickets are finalized here)
            await db.query(
                'UPDATE ticket_logs SET end_time = CURRENT_TIMESTAMP, claimer_id = $2 WHERE channel_id = $1',
                [channelId, staff_id]
            );

            // 4. Delete pending request
            await db.query('DELETE FROM pending_rewards WHERE channel_id = $1', [channelId]);

            // 5. Notify staff member
            if (staffMember) {
                await staffMember.send(`✅ Your **${amount} R$** reward for ticket <#${channelId}> has been **approved** by <@${interaction.user.id}>! Your new balance is **${newBalance} R$**. The ticket channel can now be finalized and deleted.`);
            }

            // 6. Final confirmation
            await interaction.editReply({
                content: `✅ Reward of **${amount} R$** approved for <@${staff_id}>. Staff notified. Ticket channel <#${channelId}> is ready for finalization.`
            });

        } catch (error) {
            console.error('Error during reward approval:', error);
            await interaction.editReply({ content: '❌ A critical error occurred during approval. Check logs.' });
        }

    } else {
        // Denial Logic
        try {
            // 2. Delete pending request
            await db.query('DELETE FROM pending_rewards WHERE channel_id = $1', [channelId]);

            // 3. Notify staff member
            if (staffMember) {
                await staffMember.send(`❌ Your **${amount} R$** reward request for ticket <#${channelId}> has been **denied** by <@${interaction.user.id}>. The ticket channel is still locked.`);
            }

            // 4. Final confirmation
            await interaction.editReply({
                content: `❌ Reward request for <#${channelId}> denied. Staff member <@${staff_id}> notified.`
            });
        } catch (error) {
            console.error('Error during reward denial:', error);
            await interaction.editReply({ content: '❌ An error occurred during denial. Check logs.' });
        }
    }
}


/**
 * Handles the 'Delete' button press (generates transcript, deletes channel).
 * NOTE: This function should only be used after a reward request has been approved,
 * or by an Admin who wants to finalize a ticket without payout.
 * @param {ButtonInteraction} interaction
 */
async function handleDelete(interaction) {
    const channel = interaction.channel;
    // Check if the ticket is already marked as closed (end_time is set) OR if it is in the pending_rewards table.
    const ticketLogResult = await db.query('SELECT creator_id, ticket_type, claimer_id FROM ticket_logs WHERE channel_id = $1 AND end_time IS NOT NULL', [channel.id]);
    const pendingRewardResult = await db.query('SELECT 1 FROM pending_rewards WHERE channel_id = $1', [channel.id]);

    const isFinalized = ticketLogResult.rows.length > 0;
    const isPending = pendingRewardResult.rows.length > 0;

    if (!isFinalized && !isPending) {
         // This means it's still an active ticket being forcibly deleted by an Admin
         await interaction.editReply({ content: '⚠️ Warning: This ticket is still open. Deleting it now will NOT award Robux. Proceeding with deletion.' });
         // We do not award Robux here as per the new two-step (request/approve) flow.
    } else if (isPending) {
         // This means the admin is trying to finalize/delete a ticket that is still waiting for reward approval.
         return interaction.editReply({ content: '❌ This ticket has a reward pending approval! Please approve or deny the reward first via the approval channel before deleting the ticket.', ephemeral: true });
    }

    const { creator_id, ticket_type } = isFinalized ? ticketLogResult.rows[0] : { creator_id: null, ticket_type: 'Unknown' }; // Fallback for active deletion
    const creator = creator_id ? await interaction.guild.members.fetch(creator_id).catch(() => ({ user: { tag: 'Unknown User' } })) : { user: { tag: 'Unknown User' } };

    // 1. Unclaim just in case
    await unclaimTicket(interaction.guild, interaction.channel.id);

    // 2. Fetch all messages for transcript
    const messages = await channel.messages.fetch({ limit: 100 });
    const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const htmlContent = generateHtmlTranscript(sortedMessages, creator);

    const logChannel = client.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
    if (!logChannel) {
        await interaction.editReply({ content: '❌ Transcript log channel not found. Deleting ticket without logging.' });
    } else {
        // 3. Upload Transcript
        const attachment = new AttachmentBuilder(Buffer.from(htmlContent), { name: `transcript-${channel.name}-${Date.now()}.html` });
        const logMessage = await logChannel.send({
            content: `**TICKET DELETED & LOGGED**\nCreator: <@${creator_id}> (${creator.user.tag})\nType: ${ticket_type}\nStaff Finalizer: <@${interaction.user.id}>`,
            files: [attachment]
        });

        // 4. Extract Hosted Link (Discord provides direct CDN link upon upload)
        const transcriptUrl = logMessage.attachments.first()?.url || 'URL not available.';

        // Add Direct Link Button
        const linkRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Direct Link')
                .setStyle(ButtonStyle.Link)
                .setURL(transcriptUrl)
        );

        await logMessage.edit({ components: [linkRow] });

        // 5. Update DB (if it's a known ticket)
        if (creator_id) {
            await db.query(
                'UPDATE ticket_logs SET end_time = CURRENT_TIMESTAMP, html_transcript_link = $2 WHERE channel_id = $1',
                [channel.id, transcriptUrl]
            );
        }

        await interaction.editReply({
            content: `✅ Ticket deleted. Transcript saved. Channel will be deleted in 5 seconds.`,
            ephemeral: true
        });
    }

    // 6. Delete Channel
    setTimeout(() => {
        channel.delete('Ticket finalized and deleted by staff.').catch(err => console.error('Error deleting channel:', err));
    }, 5000);
}


// --- Payout Approval Logic ---

/**
 * Handles the approval or denial of a Robux payout request (Fix for Bug 1).
 * @param {ButtonInteraction} interaction
 * @param {string} specificAction 'approve' or 'deny'.
 * @param {string[]} args Array containing [payoutRequestId, staffId, amount].
 */
async function handlePayoutApproval(interaction, specificAction, args) {
    await interaction.deferReply({ ephemeral: true });

    const [payoutRequestId, staffId, amountStr] = args;
    const amount = parseInt(amountStr);
    const approverId = interaction.user.id;
    const isApproval = specificAction === 'approve'; // Now correctly checking the extracted action

    // Disable buttons immediately to prevent double-processing
    const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('processed').setLabel(isApproval ? '✅ Approved' : '❌ Denied').setStyle(isApproval ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(true)
    );
    await interaction.message.edit({ components: [disabledRow] });

    if (!isApproval) {
        // Denial: Just update the message and notify the staff
        try {
            const staffMember = await client.users.fetch(staffId);
            await staffMember.send(`❌ Your Robux payout request for **${amount} R$** (Request ID: \`${payoutRequestId}\`) has been **denied** by <@${approverId}>. Please contact them for details.`);
            // This is the message the user was incorrectly seeing when they hit 'Approve'
            return interaction.editReply({ content: `❌ Successfully denied payout request for <@${staffId}>.` });
        } catch (error) {
            console.error('Error denying payout:', error);
            return interaction.editReply({ content: `❌ Denied, but could not DM staff member <@${staffId}>.` });
        }
    }

    // Approval Logic
    try {
        // 1. Get staff's current balance again (for double check)
        const balanceResult = await db.query('SELECT robux_balance FROM staff_data WHERE user_id = $1', [staffId]);
        const currentBalance = balanceResult.rows.length > 0 ? balanceResult.rows[0].robux_balance : 0;

        if (currentBalance < amount) {
            return interaction.editReply({ content: `⚠️ Cannot approve. Staff member's balance (**${currentBalance} R$**) is now less than the requested amount (**${amount} R$**). Request rejected.` });
        }

        // 2. Reset Balance and Log Transaction (using negative amount in updateRobuxBalance)
        await updateRobuxBalance(staffId, -amount);

        // 3. Log the successful transaction
        const gamepassLink = interaction.message.embeds[0].fields.find(f => f.name === 'Gamepass Link')?.value || 'N/A';

        await db.query(
            'INSERT INTO transaction_logs (staff_id, amount_paid, gamepass_link, admin_approver_id) VALUES ($1, $2, $3, $4)',
            [staffId, amount, gamepassLink, approverId]
        );

        // 4. Notify Staff Member
        const staffMember = await client.users.fetch(staffId);
        await staffMember.send(
            `✅ Your Robux payout request for **${amount} R$** (Request ID: \`${payoutRequestId}\`) has been **approved** by <@${approverId}>! Your balance has been reset to **${currentBalance - amount} R$**.\n\nPlease ensure your **Roblox Gamepass** is correctly configured to receive the payment shortly.`
        );

        // 5. Final Confirmation
        await interaction.editReply({ content: `✅ Payout of **${amount} R$** to <@${staffId}> approved and logged. Staff notified. Balance updated.` });

    } catch (error) {
        console.error('Error during payout approval:', error);
        await updateRobuxBalance(staffId, amount); // CRITICAL: Rollback balance if transaction fails
        await interaction.editReply({ content: '❌ A critical error occurred during approval and transaction logging. Balance has been potentially rolled back. Check logs immediately.' });
    }
}

// Start the bot
client.login(DISCORD_TOKEN);
