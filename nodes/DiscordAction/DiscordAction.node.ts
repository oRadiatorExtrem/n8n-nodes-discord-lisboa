import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	IDataObject,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	REST,
	Routes,
	ChannelType,
	GuildScheduledEventEntityType,
	GuildScheduledEventPrivacyLevel,
} from 'discord.js';
import { fetchGuilds, fetchTextChannels, fetchAllChannels, fetchRoles } from '../shared/discordRest';
import type { DiscordCredentials } from '../shared/types';

function makeRest(token: string): REST {
	return new REST({ version: '10' }).setToken(token);
}

export class DiscordAction implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Discord Action (Lisboa)',
		name: 'discordAction',
		icon: 'file:discord-logo.svg',
		group: ['output'],
		version: 1,
		description: 'Send messages, manage channels, and create events via Discord API v10',
		subtitle: '={{$parameter["operation"]}}',
		defaults: { name: 'Discord Action' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'discordBotApi',
				required: true,
			},
		],
		properties: [
			// ─── Operation ──────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'sendMessage',
				options: [
					{
						name: 'Send Message',
						value: 'sendMessage',
						description: 'Send a text message to a channel',
						action: 'Send a text message to a channel',
					},
					{
						name: 'Send Embed',
						value: 'sendEmbed',
						description: 'Send an embedded rich message to a channel',
						action: 'Send an embed to a channel',
					},
					{
						name: 'Edit Message',
						value: 'editMessage',
						description: 'Edit an existing message',
						action: 'Edit a message',
					},
					{
						name: 'Delete Message',
						value: 'deleteMessage',
						description: 'Delete a message',
						action: 'Delete a message',
					},
					{
						name: 'Add Reaction',
						value: 'addReaction',
						description: 'Add an emoji reaction to a message',
						action: 'Add a reaction to a message',
					},
					{
						name: 'Remove Reaction',
						value: 'removeReaction',
						description: "Remove a reaction from a message",
						action: 'Remove a reaction from a message',
					},
					{
						name: 'Get Messages',
						value: 'getMessages',
						description: 'Fetch recent messages from a channel',
						action: 'Fetch messages from a channel',
					},
					{
						name: 'Create Channel',
						value: 'createChannel',
						description: 'Create a new text channel in a server',
						action: 'Create a channel',
					},
					{
						name: 'Delete Channel',
						value: 'deleteChannel',
						description: 'Delete a channel',
						action: 'Delete a channel',
					},
					{
						name: 'Create Scheduled Event',
						value: 'createEvent',
						description: 'Create a guild scheduled event',
						action: 'Create a scheduled event',
					},
					{
						name: 'Delete Scheduled Event',
						value: 'deleteEvent',
						description: 'Delete a guild scheduled event',
						action: 'Delete a scheduled event',
					},
					{
						name: 'Get Guild Info',
						value: 'getGuild',
						description: 'Get basic information about a server',
						action: 'Get guild info',
					},
				],
			},

			// ─── channelId (shared by most operations) ─────────────────────────
			{
				displayName: 'Channel ID',
				name: 'channelId',
				type: 'string',
				displayOptions: {
					show: {
						operation: [
							'sendMessage',
							'sendEmbed',
							'editMessage',
							'deleteMessage',
							'addReaction',
							'removeReaction',
							'getMessages',
							'deleteChannel',
						],
					},
				},
				default: '',
				required: true,
				placeholder: '123456789012345678',
				description: 'The ID of the Discord channel',
			},

			// ─── messageId ─────────────────────────────────────────────────────
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['editMessage', 'deleteMessage', 'addReaction', 'removeReaction'],
					},
				},
				default: '',
				required: true,
				placeholder: '123456789012345678',
			},

			// ─── sendMessage ────────────────────────────────────────────────────
			{
				displayName: 'Message Content',
				name: 'messageContent',
				type: 'string',
				typeOptions: { rows: 4 },
				displayOptions: { show: { operation: ['sendMessage'] } },
				default: '',
				required: true,
				placeholder: 'Hello from n8n!',
			},
			{
				displayName: 'Reply to Message ID',
				name: 'replyToMessageId',
				type: 'string',
				displayOptions: { show: { operation: ['sendMessage'] } },
				default: '',
				description: 'If set, the message will be sent as a reply to this message ID',
			},
			{
				displayName: 'Suppress Embeds',
				name: 'suppressEmbeds',
				type: 'boolean',
				displayOptions: { show: { operation: ['sendMessage'] } },
				default: false,
			},

			// ─── sendEmbed ──────────────────────────────────────────────────────
			{
				displayName: 'Embed Title',
				name: 'embedTitle',
				type: 'string',
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: '',
			},
			{
				displayName: 'Embed Description',
				name: 'embedDescription',
				type: 'string',
				typeOptions: { rows: 4 },
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: '',
			},
			{
				displayName: 'Embed Color (hex)',
				name: 'embedColor',
				type: 'color',
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: '#5865F2',
			},
			{
				displayName: 'Embed URL',
				name: 'embedUrl',
				type: 'string',
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: '',
				placeholder: 'https://example.com',
			},
			{
				displayName: 'Embed Image URL',
				name: 'embedImageUrl',
				type: 'string',
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: '',
				placeholder: 'https://example.com/image.png',
			},
			{
				displayName: 'Embed Thumbnail URL',
				name: 'embedThumbnailUrl',
				type: 'string',
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: '',
			},
			{
				displayName: 'Embed Footer Text',
				name: 'embedFooterText',
				type: 'string',
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: '',
			},
			{
				displayName: 'Embed Author Name',
				name: 'embedAuthorName',
				type: 'string',
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: '',
			},
			{
				displayName: 'Embed Fields',
				name: 'embedFields',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: {},
				placeholder: 'Add field',
				options: [
					{
						name: 'field',
						displayName: 'Field',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								required: true,
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								required: true,
							},
							{
								displayName: 'Inline',
								name: 'inline',
								type: 'boolean',
								default: false,
							},
						],
					},
				],
			},
			{
				displayName: 'Text Content (above embed)',
				name: 'embedTextContent',
				type: 'string',
				displayOptions: { show: { operation: ['sendEmbed'] } },
				default: '',
				description: 'Optional plain-text message to send alongside the embed',
			},

			// ─── editMessage ────────────────────────────────────────────────────
			{
				displayName: 'New Content',
				name: 'editContent',
				type: 'string',
				typeOptions: { rows: 4 },
				displayOptions: { show: { operation: ['editMessage'] } },
				default: '',
				required: true,
			},

			// ─── reactions ──────────────────────────────────────────────────────
			{
				displayName: 'Emoji',
				name: 'emoji',
				type: 'string',
				displayOptions: { show: { operation: ['addReaction', 'removeReaction'] } },
				default: '',
				placeholder: '👍 or custom_name:12345678',
				description: 'Unicode emoji (e.g. 👍) or custom emoji in name:id format',
				required: true,
			},
			{
				displayName: 'User ID (for removal)',
				name: 'reactionUserId',
				type: 'string',
				displayOptions: { show: { operation: ['removeReaction'] } },
				default: '@me',
				description: 'User ID whose reaction to remove. Use "@me" for the bot\'s own reaction.',
			},

			// ─── getMessages ────────────────────────────────────────────────────
			{
				displayName: 'Limit',
				name: 'messagesLimit',
				type: 'number',
				displayOptions: { show: { operation: ['getMessages'] } },
				default: 10,
				typeOptions: { minValue: 1, maxValue: 100 },
			},
			{
				displayName: 'Before Message ID',
				name: 'beforeMessageId',
				type: 'string',
				displayOptions: { show: { operation: ['getMessages'] } },
				default: '',
				description: 'Fetch messages before this message ID (pagination)',
			},

			// ─── createChannel ──────────────────────────────────────────────────
			{
				displayName: 'Server (Guild) ID',
				name: 'guildId',
				type: 'string',
				displayOptions: { show: { operation: ['createChannel', 'createEvent', 'deleteEvent', 'getGuild'] } },
				default: '',
				required: true,
				placeholder: '123456789012345678',
			},
			{
				displayName: 'Channel Name',
				name: 'channelName',
				type: 'string',
				displayOptions: { show: { operation: ['createChannel'] } },
				default: '',
				required: true,
				placeholder: 'my-channel',
			},
			{
				displayName: 'Channel Type',
				name: 'channelType',
				type: 'options',
				displayOptions: { show: { operation: ['createChannel'] } },
				default: ChannelType.GuildText,
				options: [
					{ name: 'Text', value: ChannelType.GuildText },
					{ name: 'Voice', value: ChannelType.GuildVoice },
					{ name: 'Announcement', value: ChannelType.GuildAnnouncement },
					{ name: 'Forum', value: ChannelType.GuildForum },
				],
			},
			{
				displayName: 'Channel Topic',
				name: 'channelTopic',
				type: 'string',
				displayOptions: { show: { operation: ['createChannel'] } },
				default: '',
			},
			{
				displayName: 'Category ID',
				name: 'categoryId',
				type: 'string',
				displayOptions: { show: { operation: ['createChannel'] } },
				default: '',
				placeholder: '123456789012345678',
				description: 'Place the new channel inside this category',
			},
			{
				displayName: 'NSFW',
				name: 'channelNsfw',
				type: 'boolean',
				displayOptions: { show: { operation: ['createChannel'] } },
				default: false,
			},
			{
				displayName: 'Reason',
				name: 'reason',
				type: 'string',
				displayOptions: { show: { operation: ['createChannel', 'deleteChannel'] } },
				default: '',
				description: 'Audit log reason',
			},

			// ─── createEvent ────────────────────────────────────────────────────
			{
				displayName: 'Event Name',
				name: 'eventName',
				type: 'string',
				displayOptions: { show: { operation: ['createEvent'] } },
				default: '',
				required: true,
			},
			{
				displayName: 'Event Description',
				name: 'eventDescription',
				type: 'string',
				typeOptions: { rows: 3 },
				displayOptions: { show: { operation: ['createEvent'] } },
				default: '',
			},
			{
				displayName: 'Scheduled Start Time',
				name: 'eventStartTime',
				type: 'dateTime',
				displayOptions: { show: { operation: ['createEvent'] } },
				default: '',
				required: true,
			},
			{
				displayName: 'Scheduled End Time',
				name: 'eventEndTime',
				type: 'dateTime',
				displayOptions: { show: { operation: ['createEvent'] } },
				default: '',
			},
			{
				displayName: 'Event Type',
				name: 'eventEntityType',
				type: 'options',
				displayOptions: { show: { operation: ['createEvent'] } },
				default: GuildScheduledEventEntityType.External,
				options: [
					{ name: 'External Location', value: GuildScheduledEventEntityType.External },
					{ name: 'Voice Channel', value: GuildScheduledEventEntityType.Voice },
					{ name: 'Stage Channel', value: GuildScheduledEventEntityType.StageInstance },
				],
			},
			{
				displayName: 'Location / Channel ID',
				name: 'eventLocation',
				type: 'string',
				displayOptions: { show: { operation: ['createEvent'] } },
				default: '',
				placeholder: 'My Conference Room or 123456789012345678 for a voice channel',
				description: 'For External type: a location string. For Voice/Stage: the channel ID.',
			},

			// ─── deleteEvent ────────────────────────────────────────────────────
			{
				displayName: 'Event ID',
				name: 'eventId',
				type: 'string',
				displayOptions: { show: { operation: ['deleteEvent'] } },
				default: '',
				required: true,
				placeholder: '123456789012345678',
			},
		],
	};

	methods = {
		loadOptions: {
			async getGuilds(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
				return fetchGuilds(creds.token);
			},
			async getTextChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
				const guildId = this.getCurrentNodeParameter('guildId') as string | undefined;
				if (!guildId) return [{ name: '— select a server first —', value: '' }];
				return fetchTextChannels(creds.token, guildId);
			},
			async getAllChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
				const guildId = this.getCurrentNodeParameter('guildId') as string | undefined;
				if (!guildId) return [{ name: '— select a server first —', value: '' }];
				return fetchAllChannels(creds.token, guildId);
			},
			async getRoles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
				const guildId = this.getCurrentNodeParameter('guildId') as string | undefined;
				if (!guildId) return [{ name: '— select a server first —', value: '' }];
				return fetchRoles(creds.token, guildId);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
		const rest = makeRest(creds.token);

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;

			try {
				let result: IDataObject = {};

				if (operation === 'sendMessage') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const content = this.getNodeParameter('messageContent', i) as string;
					const replyTo = this.getNodeParameter('replyToMessageId', i, '') as string;
					const suppressEmbeds = this.getNodeParameter('suppressEmbeds', i, false) as boolean;

					const body: IDataObject = { content };
					if (suppressEmbeds) body.flags = 4; // SUPPRESS_EMBEDS
					if (replyTo) {
						body.message_reference = { message_id: replyTo };
					}

					const response = (await rest.post(Routes.channelMessages(channelId), { body })) as IDataObject;
					result = { messageId: response.id, channelId, content, timestamp: response.timestamp };

				} else if (operation === 'sendEmbed') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const title = this.getNodeParameter('embedTitle', i, '') as string;
					const description = this.getNodeParameter('embedDescription', i, '') as string;
					const color = this.getNodeParameter('embedColor', i, '#5865F2') as string;
					const url = this.getNodeParameter('embedUrl', i, '') as string;
					const imageUrl = this.getNodeParameter('embedImageUrl', i, '') as string;
					const thumbnailUrl = this.getNodeParameter('embedThumbnailUrl', i, '') as string;
					const footerText = this.getNodeParameter('embedFooterText', i, '') as string;
					const authorName = this.getNodeParameter('embedAuthorName', i, '') as string;
					const fieldsCollection = this.getNodeParameter('embedFields', i, { field: [] }) as { field: Array<{ name: string; value: string; inline: boolean }> };
					const textContent = this.getNodeParameter('embedTextContent', i, '') as string;

					// Convert hex color to integer
					const colorInt = parseInt(color.replace('#', ''), 16);

					const embed: IDataObject = {};
					if (title) embed.title = title;
					if (description) embed.description = description;
					if (!isNaN(colorInt)) embed.color = colorInt;
					if (url) embed.url = url;
					if (imageUrl) embed.image = { url: imageUrl };
					if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
					if (footerText) embed.footer = { text: footerText };
					if (authorName) embed.author = { name: authorName };
					if (fieldsCollection.field?.length) {
						embed.fields = fieldsCollection.field.map((f) => ({
							name: f.name,
							value: f.value,
							inline: f.inline ?? false,
						}));
					}

					const body: IDataObject = { embeds: [embed] };
					if (textContent) body.content = textContent;

					const response = (await rest.post(Routes.channelMessages(channelId), { body })) as IDataObject;
					result = { messageId: response.id, channelId, timestamp: response.timestamp };

				} else if (operation === 'editMessage') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const messageId = this.getNodeParameter('messageId', i) as string;
					const newContent = this.getNodeParameter('editContent', i) as string;

					const response = (await rest.patch(Routes.channelMessage(channelId, messageId), {
						body: { content: newContent },
					})) as IDataObject;
					result = { messageId: response.id, channelId, editedTimestamp: response.edited_timestamp };

				} else if (operation === 'deleteMessage') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const messageId = this.getNodeParameter('messageId', i) as string;

					await rest.delete(Routes.channelMessage(channelId, messageId));
					result = { deleted: true, messageId, channelId };

				} else if (operation === 'addReaction') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const messageId = this.getNodeParameter('messageId', i) as string;
					const emoji = this.getNodeParameter('emoji', i) as string;

					await rest.put(Routes.channelMessageOwnReaction(channelId, messageId, encodeURIComponent(emoji)));
					result = { added: true, emoji, messageId, channelId };

				} else if (operation === 'removeReaction') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const messageId = this.getNodeParameter('messageId', i) as string;
					const emoji = this.getNodeParameter('emoji', i) as string;
					const userId = this.getNodeParameter('reactionUserId', i, '@me') as string;

					const encodedEmoji = encodeURIComponent(emoji);
					if (userId === '@me') {
						await rest.delete(Routes.channelMessageOwnReaction(channelId, messageId, encodedEmoji));
					} else {
						await rest.delete(Routes.channelMessageUserReaction(channelId, messageId, encodedEmoji, userId));
					}
					result = { removed: true, emoji, messageId, channelId, userId };

				} else if (operation === 'getMessages') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const limit = this.getNodeParameter('messagesLimit', i, 10) as number;
					const beforeId = this.getNodeParameter('beforeMessageId', i, '') as string;

					const query = new URLSearchParams();
					query.set('limit', String(limit));
					if (beforeId) query.set('before', beforeId);

					const messages = (await rest.get(Routes.channelMessages(channelId), { query })) as IDataObject[];
					for (const msg of messages) {
						returnData.push({
							json: {
								id: msg.id,
								content: msg.content,
								authorId: (msg.author as IDataObject)?.id,
								authorUsername: (msg.author as IDataObject)?.username,
								timestamp: msg.timestamp,
								channelId,
								attachments: msg.attachments,
							},
						});
					}
					continue; // items already pushed above

				} else if (operation === 'createChannel') {
					const guildId = this.getNodeParameter('guildId', i) as string;
					const name = this.getNodeParameter('channelName', i) as string;
					const type = this.getNodeParameter('channelType', i, ChannelType.GuildText) as number;
					const topic = this.getNodeParameter('channelTopic', i, '') as string;
					const parentId = this.getNodeParameter('categoryId', i, '') as string;
					const nsfw = this.getNodeParameter('channelNsfw', i, false) as boolean;
					const reason = this.getNodeParameter('reason', i, '') as string;

					const body: IDataObject = { name, type, nsfw };
					if (topic) body.topic = topic;
					if (parentId) body.parent_id = parentId;

					const channel = (await rest.post(Routes.guildChannels(guildId), {
						body,
						reason: reason || undefined,
					})) as IDataObject;
					result = { channelId: channel.id, name: channel.name, type: channel.type, guildId };

				} else if (operation === 'deleteChannel') {
					const channelId = this.getNodeParameter('channelId', i) as string;
					const reason = this.getNodeParameter('reason', i, '') as string;

					const channel = (await rest.delete(Routes.channel(channelId), {
						reason: reason || undefined,
					})) as IDataObject;
					result = { deleted: true, channelId: channel.id, name: channel.name };

				} else if (operation === 'createEvent') {
					const guildId = this.getNodeParameter('guildId', i) as string;
					const name = this.getNodeParameter('eventName', i) as string;
					const description = this.getNodeParameter('eventDescription', i, '') as string;
					const startTime = this.getNodeParameter('eventStartTime', i) as string;
					const endTime = this.getNodeParameter('eventEndTime', i, '') as string;
					const entityType = this.getNodeParameter('eventEntityType', i, GuildScheduledEventEntityType.External) as number;
					const location = this.getNodeParameter('eventLocation', i, '') as string;

					const body: IDataObject = {
						name,
						privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
						scheduled_start_time: new Date(startTime).toISOString(),
						entity_type: entityType,
					};
					if (description) body.description = description;
					if (endTime) body.scheduled_end_time = new Date(endTime).toISOString();
					if (entityType === GuildScheduledEventEntityType.External) {
						body.entity_metadata = { location: location || 'TBD' };
					} else if (location) {
						body.channel_id = location;
					}

					const event = (await rest.post(Routes.guildScheduledEvents(guildId), { body })) as IDataObject;
					result = {
						eventId: event.id,
						name: event.name,
						status: event.status,
						guildId,
						scheduledStartTime: event.scheduled_start_time,
					};

				} else if (operation === 'deleteEvent') {
					const guildId = this.getNodeParameter('guildId', i) as string;
					const eventId = this.getNodeParameter('eventId', i) as string;

					await rest.delete(Routes.guildScheduledEvent(guildId, eventId));
					result = { deleted: true, eventId, guildId };

				} else if (operation === 'getGuild') {
					const guildId = this.getNodeParameter('guildId', i) as string;
					const guild = (await rest.get(Routes.guild(guildId))) as IDataObject;
					result = {
						id: guild.id,
						name: guild.name,
						description: guild.description,
						ownerId: guild.owner_id,
						memberCount: guild.approximate_member_count,
						iconUrl: guild.icon
							? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
							: null,
					};
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
				}

				returnData.push({ json: result, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
