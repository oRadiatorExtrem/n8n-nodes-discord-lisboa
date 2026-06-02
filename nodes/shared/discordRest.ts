/**
 * Thin REST helpers used by loadOptionsMethods in action/interaction nodes.
 * Pure HTTP — no WebSocket connection required.
 */
import { REST, Routes } from 'discord.js';
import type { INodePropertyOptions } from 'n8n-workflow';

interface Guild {
	id: string;
	name: string;
}

interface Channel {
	id: string;
	name: string;
	type: number;
}

interface Role {
	id: string;
	name: string;
}

function makeRest(token: string): REST {
	return new REST({ version: '10' }).setToken(token);
}

export async function fetchGuilds(token: string): Promise<INodePropertyOptions[]> {
	const rest = makeRest(token);
	const guilds = (await rest.get(Routes.userGuilds())) as Guild[];
	return guilds.map((g) => ({ name: g.name, value: g.id }));
}

export async function fetchTextChannels(token: string, guildId: string): Promise<INodePropertyOptions[]> {
	const rest = makeRest(token);
	const channels = (await rest.get(Routes.guildChannels(guildId))) as Channel[];
	// type 0 = GUILD_TEXT, type 5 = GUILD_ANNOUNCEMENT
	return channels
		.filter((c) => c.type === 0 || c.type === 5)
		.map((c) => ({ name: `#${c.name}`, value: c.id }));
}

export async function fetchAllChannels(token: string, guildId: string): Promise<INodePropertyOptions[]> {
	const rest = makeRest(token);
	const channels = (await rest.get(Routes.guildChannels(guildId))) as Channel[];
	return channels.map((c) => ({ name: c.name, value: c.id }));
}

export async function fetchRoles(token: string, guildId: string): Promise<INodePropertyOptions[]> {
	const rest = makeRest(token);
	const roles = (await rest.get(Routes.guildRoles(guildId))) as Role[];
	return roles
		.filter((r) => r.name !== '@everyone')
		.map((r) => ({ name: r.name, value: r.id }));
}
