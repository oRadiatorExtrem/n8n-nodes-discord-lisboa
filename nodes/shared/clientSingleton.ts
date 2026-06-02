/**
 * Module-level singleton pool: one Discord WebSocket client per bot token.
 * Trigger and Interaction nodes share the same client; it is destroyed only
 * when the last consumer calls releaseSharedClient().
 *
 * Intents are intentionally maximal so that any combination of trigger types
 * works on the same shared client. The bot owner must enable the three
 * privileged intents (GuildMembers, GuildPresences, MessageContent) in the
 * Discord Developer Portal.
 */
import {
	Client,
	GatewayIntentBits,
	Partials,
} from 'discord.js';

const INTENTS = [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMembers,         // privileged
	GatewayIntentBits.GuildModeration,
	GatewayIntentBits.GuildEmojisAndStickers,
	GatewayIntentBits.GuildIntegrations,
	GatewayIntentBits.GuildWebhooks,
	GatewayIntentBits.GuildInvites,
	GatewayIntentBits.GuildVoiceStates,
	GatewayIntentBits.GuildPresences,       // privileged
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.GuildMessageReactions,
	GatewayIntentBits.GuildMessageTyping,
	GatewayIntentBits.DirectMessages,
	GatewayIntentBits.DirectMessageReactions,
	GatewayIntentBits.MessageContent,       // privileged — required for message content
	GatewayIntentBits.GuildScheduledEvents,
	GatewayIntentBits.AutoModerationConfiguration,
	GatewayIntentBits.AutoModerationExecution,
];

const PARTIALS = [
	Partials.Message,
	Partials.Channel,
	Partials.Reaction,
	Partials.User,
	Partials.GuildMember,
];

interface ClientEntry {
	client: Client;
	refCount: number;
	readyPromise: Promise<void>;
}

const pool = new Map<string, ClientEntry>();

export async function getSharedClient(token: string): Promise<Client> {
	const existing = pool.get(token);
	if (existing) {
		existing.refCount++;
		await existing.readyPromise;
		return existing.client;
	}

	const client = new Client({ intents: INTENTS, partials: PARTIALS });

	const readyPromise = new Promise<void>((resolve, reject) => {
		client.once('ready', () => resolve());
		client.once('error', reject);
	});

	// Log non-fatal errors so the process doesn't crash on network blips.
	client.on('error', (err) => {
		const preview = token.slice(0, 8);
		console.error(`[discord-node] client error (token ...${preview}):`, err.message);
	});

	const entry: ClientEntry = { client, refCount: 1, readyPromise };
	pool.set(token, entry);

	try {
		await client.login(token);
		await readyPromise;
	} catch (err) {
		pool.delete(token);
		client.destroy();
		throw err;
	}

	return client;
}

export function releaseSharedClient(token: string): void {
	const entry = pool.get(token);
	if (!entry) return;
	entry.refCount--;
	if (entry.refCount <= 0) {
		pool.delete(token);
		entry.client.destroy();
	}
}
