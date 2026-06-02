/**
 * DiscordInteraction — sends a message with Confirm / Cancel buttons and waits
 * for a user to click one. Produces three output branches:
 *   0 → Confirm
 *   1 → Cancel
 *   2 → No response (timeout)
 *
 * Uses the shared WebSocket client (same token pool as DiscordTrigger).
 */
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
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ChannelType,
	REST,
	Routes,
} from 'discord.js';
import type { TextChannel, NewsChannel } from 'discord.js';
import { getSharedClient, releaseSharedClient } from '../shared/clientSingleton';
import { fetchGuilds, fetchTextChannels } from '../shared/discordRest';
import type { DiscordCredentials } from '../shared/types';

function makeRest(token: string): REST {
	return new REST({ version: '10' }).setToken(token);
}

export class DiscordInteraction implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Discord Interaction',
		name: 'discordInteraction',
		icon: 'file:discord-logo.svg',
		group: ['output'],
		version: 1,
		description: 'Send a Discord message with optional buttons and wait for a user response',
		defaults: { name: 'Discord Interaction' },
		inputs: ['main'],
		outputs: ['main', 'main', 'main'],
		outputNames: ['Confirm', 'Cancel', 'No Response'],
		credentials: [
			{
				name: 'discordBotApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Action',
				name: 'action',
				type: 'options',
				noDataExpression: true,
				default: 'prompt',
				options: [
					{
						name: 'Send Prompt (with Confirm/Cancel)',
						value: 'prompt',
						description: 'Send a message with Confirm and Cancel buttons and wait for a click',
					},
					{
						name: 'Send Message',
						value: 'sendMessage',
						description: 'Send a plain message without waiting for a response',
					},
					{
						name: 'Get Messages',
						value: 'getMessages',
						description: 'Retrieve recent messages from a channel',
					},
				],
			},
			// ─── Channel ID ─────────────────────────────────────────────────────
			{
				displayName: 'Channel ID',
				name: 'channelId',
				type: 'string',
				displayOptions: { show: { action: ['prompt', 'sendMessage', 'getMessages'] } },
				default: '',
				required: true,
				placeholder: '123456789012345678',
			},
			// ─── Message content ────────────────────────────────────────────────
			{
				displayName: 'Message',
				name: 'messageContent',
				type: 'string',
				typeOptions: { rows: 3 },
				displayOptions: { show: { action: ['prompt', 'sendMessage'] } },
				default: '',
				required: true,
				placeholder: 'Are you sure you want to proceed?',
			},
			// ─── Prompt options ─────────────────────────────────────────────────
			{
				displayName: 'Confirm Button Label',
				name: 'confirmLabel',
				type: 'string',
				displayOptions: { show: { action: ['prompt'] } },
				default: 'Confirm',
			},
			{
				displayName: 'Cancel Button Label',
				name: 'cancelLabel',
				type: 'string',
				displayOptions: { show: { action: ['prompt'] } },
				default: 'Cancel',
			},
			{
				displayName: 'Timeout (seconds)',
				name: 'timeoutSeconds',
				type: 'number',
				displayOptions: { show: { action: ['prompt'] } },
				default: 30,
				typeOptions: { minValue: 5, maxValue: 300 },
				description: 'How long to wait for a response before sending output to the "No Response" branch',
			},
			{
				displayName: 'Allow Any User to Respond',
				name: 'allowAnyUser',
				type: 'boolean',
				displayOptions: { show: { action: ['prompt'] } },
				default: true,
				description: 'If disabled, only the user whose ID matches "Allowed User ID" can click the buttons',
			},
			{
				displayName: 'Allowed User ID',
				name: 'allowedUserId',
				type: 'string',
				displayOptions: { show: { action: ['prompt'], allowAnyUser: [false] } },
				default: '',
				placeholder: '123456789012345678',
			},
			{
				displayName: 'Delete Prompt Message After Response',
				name: 'deleteAfter',
				type: 'boolean',
				displayOptions: { show: { action: ['prompt'] } },
				default: false,
			},
			// ─── getMessages options ─────────────────────────────────────────────
			{
				displayName: 'Limit',
				name: 'messagesLimit',
				type: 'number',
				displayOptions: { show: { action: ['getMessages'] } },
				default: 10,
				typeOptions: { minValue: 1, maxValue: 100 },
			},
		],
	};

	methods = {
		loadOptions: {
			async getGuilds(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
				return fetchGuilds(creds.token);
			},
			async getChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;
				const guildId = this.getCurrentNodeParameter('guildId') as string | undefined;
				if (!guildId) return [{ name: '— select a server first —', value: '' }];
				return fetchTextChannels(creds.token, guildId);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;

		const confirmItems: INodeExecutionData[] = [];
		const cancelItems: INodeExecutionData[] = [];
		const timeoutItems: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const action = this.getNodeParameter('action', i) as string;
			const channelId = this.getNodeParameter('channelId', i) as string;

			try {
				if (action === 'sendMessage') {
					const rest = makeRest(creds.token);
					const content = this.getNodeParameter('messageContent', i) as string;
					const response = (await rest.post(Routes.channelMessages(channelId), {
						body: { content },
					})) as IDataObject;
					confirmItems.push({
						json: { messageId: response.id, channelId, content },
						pairedItem: { item: i },
					});

				} else if (action === 'getMessages') {
					const rest = makeRest(creds.token);
					const limit = this.getNodeParameter('messagesLimit', i, 10) as number;
					const q = new URLSearchParams();
					q.set('limit', String(limit));
					const messages = (await rest.get(Routes.channelMessages(channelId), { query: q })) as IDataObject[];
					for (const msg of messages) {
						confirmItems.push({
							json: {
								id: msg.id,
								content: msg.content,
								authorId: (msg.author as IDataObject)?.id,
								authorUsername: (msg.author as IDataObject)?.username,
								timestamp: msg.timestamp,
								channelId,
							},
							pairedItem: { item: i },
						});
					}

				} else if (action === 'prompt') {
					const messageContent = this.getNodeParameter('messageContent', i) as string;
					const confirmLabel = this.getNodeParameter('confirmLabel', i, 'Confirm') as string;
					const cancelLabel = this.getNodeParameter('cancelLabel', i, 'Cancel') as string;
					const timeoutSeconds = this.getNodeParameter('timeoutSeconds', i, 30) as number;
					const allowAnyUser = this.getNodeParameter('allowAnyUser', i, true) as boolean;
					const allowedUserId = this.getNodeParameter('allowedUserId', i, '') as string;
					const deleteAfter = this.getNodeParameter('deleteAfter', i, false) as boolean;

					const client = await getSharedClient(creds.token);

					try {
						const channel = await client.channels.fetch(channelId);
						if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement && channel.type !== ChannelType.DM)) {
							throw new NodeOperationError(this.getNode(), `Channel ${channelId} is not a text channel`, { itemIndex: i });
						}

						const textChannel = channel as TextChannel | NewsChannel;

						// Build buttons
						const confirmBtn = new ButtonBuilder()
							.setCustomId('discord_interaction_confirm')
							.setLabel(confirmLabel)
							.setStyle(ButtonStyle.Success);

						const cancelBtn = new ButtonBuilder()
							.setCustomId('discord_interaction_cancel')
							.setLabel(cancelLabel)
							.setStyle(ButtonStyle.Danger);

						const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

						const sentMessage = await textChannel.send({
							content: messageContent,
							components: [row],
						});

						let interaction;
						try {
							interaction = await sentMessage.awaitMessageComponent({
								componentType: ComponentType.Button,
								time: timeoutSeconds * 1000,
								filter: allowAnyUser
									? undefined
									: (intr) => intr.user.id === allowedUserId,
							});
						} catch {
							// Timeout — no interaction received
							interaction = null;
						}

						// Disable buttons after any outcome
						const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
							ButtonBuilder.from(confirmBtn.toJSON()).setDisabled(true),
							ButtonBuilder.from(cancelBtn.toJSON()).setDisabled(true),
						);

						if (deleteAfter) {
							await sentMessage.delete().catch(() => null);
						} else {
							await sentMessage.edit({ components: [disabledRow] }).catch(() => null);
						}

						const baseData: IDataObject = {
							messageId: sentMessage.id,
							channelId,
							prompt: messageContent,
						};

						if (interaction) {
							await interaction.deferUpdate().catch(() => null);
							const responseData: IDataObject = {
								...baseData,
								respondedBy: interaction.user.id,
								respondedByUsername: interaction.user.username,
								respondedAt: interaction.createdTimestamp,
								choice: interaction.customId === 'discord_interaction_confirm' ? 'confirm' : 'cancel',
							};

							if (interaction.customId === 'discord_interaction_confirm') {
								confirmItems.push({ json: responseData, pairedItem: { item: i } });
							} else {
								cancelItems.push({ json: responseData, pairedItem: { item: i } });
							}
						} else {
							timeoutItems.push({
								json: { ...baseData, timedOut: true, timeoutSeconds },
								pairedItem: { item: i },
							});
						}
					} finally {
						releaseSharedClient(creds.token);
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					timeoutItems.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [confirmItems, cancelItems, timeoutItems];
	}
}
