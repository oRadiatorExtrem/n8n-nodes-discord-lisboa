import type {
	ITriggerFunctions,
	INodeType,
	INodeTypeDescription,
	ITriggerResponse,
	INodePropertyOptions,
	ILoadOptionsFunctions,
	IDataObject,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type {
	Message,
	GuildMember,
	Role,
	VoiceState,
	GuildScheduledEvent,
	MessageReaction,
	User,
	PartialMessage,
	PartialGuildMember,
	PartialMessageReaction,
	PartialUser,
	PartialGuildScheduledEvent,
	Snowflake,
} from 'discord.js';
import { ChannelType } from 'discord.js';
import { getSharedClient, releaseSharedClient } from '../shared/clientSingleton';
import { fetchGuilds, fetchTextChannels, fetchRoles } from '../shared/discordRest';
import type { DiscordCredentials } from '../shared/types';

type MessagePattern =
	| 'any'
	| 'botMention'
	| 'contains'
	| 'startsWith'
	| 'endsWith'
	| 'equals'
	| 'regex';

function matchesPattern(
	content: string,
	pattern: MessagePattern,
	value: string,
	botId: string | undefined,
	mentionedIds: string[],
): boolean {
	switch (pattern) {
		case 'any':         return true;
		case 'botMention':  return botId != null && mentionedIds.includes(botId);
		case 'contains':    return content.includes(value);
		case 'startsWith':  return content.startsWith(value);
		case 'endsWith':    return content.endsWith(value);
		case 'equals':      return content === value;
		case 'regex':
			try { return new RegExp(value).test(content); } catch { return false; }
		default: return true;
	}
}

// ── Serializers ──────────────────────────────────────────────────────────────

function serializeMessage(message: Message | PartialMessage): IDataObject {
	if (message.partial) {
		return { id: message.id, channelId: message.channelId, guildId: message.guildId ?? null, partial: true };
	}
	return {
		id: message.id,
		content: message.content,
		authorId: message.author?.id ?? null,
		authorUsername: message.author?.username ?? null,
		authorDisplayName: message.author?.displayName ?? null,
		authorBot: message.author?.bot ?? null,
		channelId: message.channelId,
		guildId: message.guildId ?? null,
		timestamp: message.createdTimestamp,
		editedTimestamp: message.editedTimestamp,
		attachments: message.attachments.map((a) => ({
			id: a.id, url: a.url, name: a.name, size: a.size, contentType: a.contentType,
		})),
		embedCount: message.embeds.length,
		mentionedUsers: message.mentions.users.map((u) => u.id),
		mentionedRoles: message.mentions.roles.map((r) => r.id),
		mentionedEveryone: message.mentions.everyone,
		pinned: message.pinned,
		messageUrl: message.url,
	};
}

function serializeMember(member: GuildMember | PartialGuildMember): IDataObject {
	const base: IDataObject = { userId: member.id, guildId: member.guild.id, guildName: member.guild.name };
	if ('user' in member && member.user) {
		base.username = member.user.username;
		base.displayName = member.user.displayName;
		base.avatarUrl = member.user.displayAvatarURL();
	}
	if ('nickname' in member) base.nickname = member.nickname ?? null;
	if ('joinedTimestamp' in member) base.joinedAt = member.joinedTimestamp ?? null;
	if ('roles' in member && member.roles) {
		base.roles = member.roles.cache.map((r) => ({ id: r.id, name: r.name }));
	}
	return base;
}

function serializeRole(role: Role): IDataObject {
	return {
		id: role.id, name: role.name, color: role.hexColor, position: role.position,
		permissions: role.permissions.toArray(), guildId: role.guild.id,
		mentionable: role.mentionable, hoist: role.hoist, managed: role.managed,
		createdTimestamp: role.createdTimestamp,
	};
}

function serializeVoiceState(state: VoiceState): IDataObject {
	return {
		userId: state.id, username: state.member?.user.username ?? null,
		guildId: state.guild.id, channelId: state.channelId ?? null,
		channelName: state.channel?.name ?? null,
		selfMute: state.selfMute, selfDeaf: state.selfDeaf, selfVideo: state.selfVideo,
		serverMute: state.serverMute, serverDeaf: state.serverDeaf,
		streaming: state.streaming, suppress: state.suppress,
	};
}

function serializeReaction(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
): IDataObject {
	return {
		emoji: reaction.emoji.name, emojiId: reaction.emoji.id ?? null,
		emojiAnimated: reaction.emoji.animated ?? false, count: reaction.count ?? null,
		messageId: reaction.message.id, channelId: reaction.message.channelId,
		guildId: reaction.message.guildId ?? null, userId: user.id, username: user.username ?? null,
	};
}

// ── Node ─────────────────────────────────────────────────────────────────────

export class DiscordTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Discord Trigger',
		name: 'discordTrigger',
		icon: 'file:discord-logo.svg',
		group: ['trigger'],
		version: 1,
		description: 'Triggers a workflow on Discord events via WebSocket (discord.js v14 / API v10)',
		defaults: { name: 'Discord Trigger' },
		inputs: [],
		outputs: ['main'],
		credentials: [{ name: 'discordBotApi', required: true }],
		properties: [

			// ── Trigger type ────────────────────────────────────────────────────
			{
				displayName: 'Trigger Type',
				name: 'triggerType',
				type: 'options',
				noDataExpression: true,
				default: 'message',
				options: [
					{ name: 'New Message',              value: 'message' },
					{ name: 'Message Updated',          value: 'messageUpdate' },
					{ name: 'Message Deleted',          value: 'messageDelete' },
					{ name: 'Reaction Added',           value: 'reactionAdd' },
					{ name: 'Reaction Removed',         value: 'reactionRemove' },
					{ name: 'Member Joined Server',     value: 'memberJoin' },
					{ name: 'Member Left Server',       value: 'memberLeave' },
					{ name: 'Member Updated',           value: 'memberUpdate' },
					{ name: 'Role Created',             value: 'roleCreate' },
					{ name: 'Role Deleted',             value: 'roleDelete' },
					{ name: 'Role Updated',             value: 'roleUpdate' },
					{ name: 'Voice State Changed',      value: 'voiceStateUpdate' },
					{ name: 'Scheduled Event Created',  value: 'scheduledEventCreate' },
					{ name: 'Scheduled Event Updated',  value: 'scheduledEventUpdate' },
				],
			},

			// ── Message pattern (only for 'message') ────────────────────────────
			{
				displayName: 'Message Pattern',
				name: 'messagePattern',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { triggerType: ['message'] } },
				default: 'any',
				options: [
					{ name: 'Any message',     value: 'any' },
					{ name: '@Bot mention',    value: 'botMention' },
					{ name: 'Contains text',   value: 'contains' },
					{ name: 'Starts with',     value: 'startsWith' },
					{ name: 'Ends with',       value: 'endsWith' },
					{ name: 'Exact match',     value: 'equals' },
					{ name: 'Regex pattern',   value: 'regex' },
				],
			},
			{
				displayName: 'Pattern Value',
				name: 'patternValue',
				type: 'string',
				displayOptions: {
					show: {
						triggerType: ['message'],
						messagePattern: ['contains', 'startsWith', 'endsWith', 'equals', 'regex'],
					},
				},
				default: '',
				placeholder: '!hello  or  ^hello.+world$  (for regex)',
				description: 'Text or regex pattern to match against the message content',
			},

			// ── Message flags ───────────────────────────────────────────────────
			{
				displayName: 'Ignore Bot Messages',
				name: 'ignoreBots',
				type: 'boolean',
				displayOptions: { show: { triggerType: ['message', 'messageUpdate', 'messageDelete'] } },
				default: true,
				description: 'Whether to skip messages sent by other bots',
			},
			{
				displayName: 'Allow Direct Messages',
				name: 'allowDMs',
				type: 'boolean',
				displayOptions: { show: { triggerType: ['message'] } },
				default: false,
				description: 'Whether to trigger on DMs in addition to server messages',
			},

			// ── Server filter (dropdown — populated via REST) ────────────────────
			{
				displayName: 'Server',
				name: 'guildId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getGuilds' },
				default: '',
				description:
					'The Discord server to listen to. Select from the list or leave empty to listen to all servers where the bot is present.',
			},

			// ── Channel filter (multi-select — depends on selected server) ───────
			{
				displayName: 'Channels',
				name: 'channelIds',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getChannels',
					loadOptionsDependsOn: ['guildId'],
				},
				displayOptions: {
					show: {
						triggerType: ['message', 'messageUpdate', 'messageDelete', 'reactionAdd', 'reactionRemove'],
					},
				},
				default: [],
				description: 'Channels to listen to. Leave empty to listen to all text channels in the selected server.',
			},

			// ── Role filter (multi-select — depends on selected server) ──────────
			{
				displayName: 'Required Roles',
				name: 'roleIds',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getRoles',
					loadOptionsDependsOn: ['guildId'],
				},
				displayOptions: {
					show: {
						triggerType: ['message', 'memberUpdate'],
					},
				},
				default: [],
				description:
					'Only trigger if the message author (or updated member) has at least one of these roles. Leave empty to allow all.',
			},

			// ── User ID filter (text — no Discord endpoint to list all users) ────
			{
				displayName: 'Filter by User IDs',
				name: 'userIds',
				type: 'string',
				displayOptions: {
					show: {
						triggerType: ['message', 'messageUpdate', 'memberJoin', 'memberLeave', 'memberUpdate', 'voiceStateUpdate'],
					},
				},
				default: '',
				placeholder: '123456789012345678, 987654321098765432',
				description: 'Comma-separated list of user IDs. Leave empty to allow all users.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getGuilds(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
				const guilds = await fetchGuilds(creds.token);
				return [{ name: '(All Servers)', value: '' }, ...guilds];
			},
			async getChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
				const guildId = this.getCurrentNodeParameter('guildId') as string | undefined;
				if (!guildId) return [{ name: '— select a server first —', value: '__none__' }];
				return fetchTextChannels(creds.token, guildId);
			},
			async getRoles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
				const guildId = this.getCurrentNodeParameter('guildId') as string | undefined;
				if (!guildId) return [{ name: '— select a server first —', value: '__none__' }];
				return fetchRoles(creds.token, guildId);
			},
		},
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const credentials = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
		if (!credentials.token) {
			throw new NodeOperationError(this.getNode(), 'Bot token is required');
		}

		const triggerType  = this.getNodeParameter('triggerType') as string;
		const guildId      = this.getNodeParameter('guildId', '') as string;
		// multiOptions returns string[]; userIds is comma-separated text
		const channelIds   = (this.getNodeParameter('channelIds', []) as string[]).filter((v) => v !== '__none__');
		const roleIds      = (this.getNodeParameter('roleIds', []) as string[]).filter((v) => v !== '__none__');
		const userIds      = (this.getNodeParameter('userIds', '') as string)
			.split(',').map((s) => s.trim()).filter(Boolean);

		const client = await getSharedClient(credentials.token);

		// ── Filter helpers ────────────────────────────────────────────────────
		const passesGuild   = (id: Snowflake | null | undefined) => !guildId || id === guildId;
		const passesChannel = (id: Snowflake) => !channelIds.length || channelIds.includes(id);
		const passesUser    = (id: Snowflake) => !userIds.length || userIds.includes(id);
		const passesMemberRoles = (member: GuildMember | PartialGuildMember | null) => {
			if (!roleIds.length) return true;
			if (!member || !('roles' in member)) return false;
			return roleIds.some((rid) => member.roles.cache.has(rid));
		};

		// ── Manual-trigger support ────────────────────────────────────────────
		let resolveManual: (() => void) | undefined;
		const manualPromise = new Promise<void>((res) => { resolveManual = res; });

		const emit = (data: IDataObject) => {
			const item: INodeExecutionData = { json: data };
			(this.emit as (data: INodeExecutionData[][]) => void)([[item]]);
			if (resolveManual) { resolveManual(); resolveManual = undefined; }
		};

		// Track registered listeners so closeFunction removes only THIS node's handlers.
		const registered: Array<{ event: string; fn: (...args: unknown[]) => void }> = [];
		const on = (event: string, fn: (...args: unknown[]) => void) => {
			client.on(event, fn);
			registered.push({ event, fn });
		};

		// ── Register event listener based on triggerType ──────────────────────
		if (triggerType === 'message') {
			const pattern      = this.getNodeParameter('messagePattern', 'any') as MessagePattern;
			const patternValue = this.getNodeParameter('patternValue', '') as string;
			const ignoreBots   = this.getNodeParameter('ignoreBots', true) as boolean;
			const allowDMs     = this.getNodeParameter('allowDMs', false) as boolean;

			on('messageCreate', (message: unknown) => {
				const msg = message as Message;
				if (ignoreBots && msg.author.bot) return;
				if (!allowDMs && msg.channel.type === ChannelType.DM) return;
				if (!passesGuild(msg.guildId)) return;
				if (!passesChannel(msg.channelId)) return;
				if (!passesUser(msg.author.id)) return;
				if (roleIds.length && !passesMemberRoles(msg.member)) return;
				const mentioned = msg.mentions.users.map((u) => u.id);
				if (!matchesPattern(msg.content, pattern, patternValue, client.user?.id, mentioned)) return;
				emit(serializeMessage(msg));
			});

		} else if (triggerType === 'messageUpdate') {
			const ignoreBots = this.getNodeParameter('ignoreBots', true) as boolean;
			on('messageUpdate', (oldMsg: unknown, newMsg: unknown) => {
				const nm = newMsg as Message | PartialMessage;
				if (ignoreBots && !nm.partial && (nm as Message).author?.bot) return;
				if (!passesGuild(nm.guildId)) return;
				if (!passesChannel(nm.channelId)) return;
				emit({ old: serializeMessage(oldMsg as Message | PartialMessage), new: serializeMessage(nm) });
			});

		} else if (triggerType === 'messageDelete') {
			const ignoreBots = this.getNodeParameter('ignoreBots', true) as boolean;
			on('messageDelete', (message: unknown) => {
				const msg = message as Message | PartialMessage;
				if (ignoreBots && !msg.partial && (msg as Message).author?.bot) return;
				if (!passesGuild(msg.guildId)) return;
				if (!passesChannel(msg.channelId)) return;
				emit(serializeMessage(msg));
			});

		} else if (triggerType === 'reactionAdd') {
			on('messageReactionAdd', (reaction: unknown, user: unknown) => {
				const r = reaction as MessageReaction | PartialMessageReaction;
				const u = user as User | PartialUser;
				if (!passesGuild(r.message.guildId)) return;
				if (!passesChannel(r.message.channelId)) return;
				emit(serializeReaction(r, u));
			});

		} else if (triggerType === 'reactionRemove') {
			on('messageReactionRemove', (reaction: unknown, user: unknown) => {
				const r = reaction as MessageReaction | PartialMessageReaction;
				const u = user as User | PartialUser;
				if (!passesGuild(r.message.guildId)) return;
				if (!passesChannel(r.message.channelId)) return;
				emit(serializeReaction(r, u));
			});

		} else if (triggerType === 'memberJoin') {
			on('guildMemberAdd', (member: unknown) => {
				const m = member as GuildMember;
				if (!passesGuild(m.guild.id)) return;
				if (!passesUser(m.id)) return;
				emit(serializeMember(m));
			});

		} else if (triggerType === 'memberLeave') {
			on('guildMemberRemove', (member: unknown) => {
				const m = member as GuildMember | PartialGuildMember;
				if (!passesGuild(m.guild.id)) return;
				if (!passesUser(m.id)) return;
				emit(serializeMember(m));
			});

		} else if (triggerType === 'memberUpdate') {
			on('guildMemberUpdate', (oldMember: unknown, newMember: unknown) => {
				const nm = newMember as GuildMember;
				if (!passesGuild(nm.guild.id)) return;
				if (!passesUser(nm.id)) return;
				if (!passesMemberRoles(nm)) return;
				emit({ old: serializeMember(oldMember as GuildMember | PartialGuildMember), new: serializeMember(nm) });
			});

		} else if (triggerType === 'roleCreate') {
			on('roleCreate', (role: unknown) => {
				const r = role as Role;
				if (!passesGuild(r.guild.id)) return;
				emit(serializeRole(r));
			});

		} else if (triggerType === 'roleDelete') {
			on('roleDelete', (role: unknown) => {
				const r = role as Role;
				if (!passesGuild(r.guild.id)) return;
				emit(serializeRole(r));
			});

		} else if (triggerType === 'roleUpdate') {
			on('roleUpdate', (_old: unknown, newRole: unknown) => {
				const nr = newRole as Role;
				if (!passesGuild(nr.guild.id)) return;
				emit({ old: serializeRole(_old as Role), new: serializeRole(nr) });
			});

		} else if (triggerType === 'voiceStateUpdate') {
			on('voiceStateUpdate', (oldState: unknown, newState: unknown) => {
				const ns = newState as VoiceState;
				if (!passesGuild(ns.guild.id)) return;
				if (!passesUser(ns.id)) return;
				emit({ old: serializeVoiceState(oldState as VoiceState), new: serializeVoiceState(ns) });
			});

		} else if (triggerType === 'scheduledEventCreate') {
			on('guildScheduledEventCreate', (event: unknown) => {
				const e = event as GuildScheduledEvent;
				if (!passesGuild(e.guild?.id)) return;
				emit({
					id: e.id, name: e.name, description: e.description ?? null,
					status: e.status, guildId: e.guild?.id ?? null, creatorId: e.creatorId ?? null,
					scheduledStartAt: e.scheduledStartTimestamp, scheduledEndAt: e.scheduledEndTimestamp ?? null,
					entityType: e.entityType, url: e.url,
				});
			});

		} else if (triggerType === 'scheduledEventUpdate') {
			on('guildScheduledEventUpdate', (_old: unknown, newEvent: unknown) => {
				const e = newEvent as GuildScheduledEvent | PartialGuildScheduledEvent;
				if (!passesGuild(e.guild?.id)) return;
				emit({ id: e.id, name: e.name, status: e.status, guildId: e.guild?.id ?? null, scheduledStartAt: e.scheduledStartTimestamp });
			});

		} else {
			throw new NodeOperationError(this.getNode(), `Unknown trigger type: ${triggerType}`);
		}

		return {
			closeFunction: async () => {
				for (const { event, fn } of registered) {
					client.off(event, fn);
				}
				releaseSharedClient(credentials.token);
			},
			manualTriggerFunction: async () => {
				await manualPromise;
			},
		};
	}
}
