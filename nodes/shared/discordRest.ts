/**
 * Thin REST helpers used by loadOptionsMethods.
 * Pure HTTP — no WebSocket required.
 */
import { REST, Routes } from 'discord.js';
import type { INodePropertyOptions } from 'n8n-workflow';

interface Guild  { id: string; name: string }
interface Channel { id: string; name: string; type: number }
interface Role    { id: string; name: string }

function makeRest(token: string): REST {
	return new REST({ version: '10' }).setToken(token);
}

async function safeGet<T>(token: string, route: `/${string}`, label: string): Promise<T[]> {
	try {
		const rest = makeRest(token);
		return (await rest.get(route)) as T[];
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Discord API error fetching ${label}: ${msg}. Check bot token and privileged intents.`);
	}
}

export async function fetchGuilds(token: string): Promise<INodePropertyOptions[]> {
	const guilds = await safeGet<Guild>(token, Routes.userGuilds() as `/${string}`, 'guilds');
	if (!guilds.length) throw new Error('Bot is not in any server. Invite the bot first.');
	return guilds.map((g) => ({ name: g.name, value: g.id }));
}

export async function fetchTextChannels(token: string, guildId: string): Promise<INodePropertyOptions[]> {
	const channels = await safeGet<Channel>(token, Routes.guildChannels(guildId) as `/${string}`, 'channels');
	// 0 = GUILD_TEXT, 5 = GUILD_ANNOUNCEMENT
	return channels
		.filter((c) => c.type === 0 || c.type === 5)
		.map((c) => ({ name: `#${c.name}`, value: c.id }));
}

export async function fetchAllChannels(token: string, guildId: string): Promise<INodePropertyOptions[]> {
	const channels = await safeGet<Channel>(token, Routes.guildChannels(guildId) as `/${string}`, 'channels');
	return channels.map((c) => ({ name: c.name, value: c.id }));
}

export async function fetchRoles(token: string, guildId: string): Promise<INodePropertyOptions[]> {
	const roles = await safeGet<Role>(token, Routes.guildRoles(guildId) as `/${string}`, 'roles');
	return roles
		.filter((r) => r.name !== '@everyone')
		.map((r) => ({ name: r.name, value: r.id }));
}
