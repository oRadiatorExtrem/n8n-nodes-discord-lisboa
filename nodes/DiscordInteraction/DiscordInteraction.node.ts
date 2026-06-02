/**
 * DiscordInteraction
 *
 * Sends a message to a Discord channel and optionally waits for a
 * Confirm / Cancel button click from a user.
 *
 * Three output branches:
 *   0 → Confirm
 *   1 → Cancel
 *   2 → No response (timeout or plain send)
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
	REST,
	Routes,
} from 'discord.js';
import type { TextBasedChannel, TextChannel, ButtonInteraction } from 'discord.js';
import { getSharedClient, releaseSharedClient } from '../shared/clientSingleton';
import { fetchGuilds, fetchTextChannels } from '../shared/discordRest';
import type { DiscordCredentials } from '../shared/types';

function makeRest(token: string): REST {
	return new REST({ version: '10' }).setToken(token);
}

export class DiscordInteraction implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Discord Interaction (Lisboa)',
		name: 'discordInteraction',
		icon: 'file:discord-logo.svg',
		group: ['output'],
		version: 1,
		description: 'Send a Discord message with optional Confirm/Cancel buttons and wait for a response',
		subtitle: '={{$parameter["action"]}}',
		defaults: { name: 'Discord Interaction' },
		inputs: ['main'],
		outputs: ['main', 'main', 'main'],
		outputNames: ['Confirm', 'Cancel', 'No Response'],
		credentials: [{ name: 'discordBotApi', required: true }],
		properties: [
			{
				displayName: 'Action',
				name: 'action',
				type: 'options',
				noDataExpression: true,
				default: 'prompt',
				options: [
					{
						name: 'Send Prompt (Confirm / Cancel)',
						value: 'prompt',
						description: 'Send a message with buttons and wait for a click. Output goes to the matching branch.',
					},
					{
						name: 'Send Message',
						value: 'sendMessage',
						description: 'Send a plain message. Output goes to the Confirm branch.',
					},
					{
						name: 'Get Messages',
						value: 'getMessages',
						description: 'Fetch recent messages from a channel. Each message is a separate item in the Confirm branch.',
					},
				],
			},

			// ── Channel ──────────────────────────────────────────────────────────
			{
				displayName: 'Channel ID',
				name: 'channelId',
				type: 'string',
				displayOptions: { show: { action: ['prompt', 'sendMessage', 'getMessages'] } },
				default: '',
				required: true,
				placeholder: '123456789012345678',
				description: 'Right-click the channel in Discord (Developer Mode on) → Copy Channel ID',
			},

			// ── Prompt options ───────────────────────────────────────────────────
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
				description: 'How long to wait before routing to the No Response branch',
			},
			{
				displayName: 'Restrict to User ID',
				name: 'allowedUserId',
				type: 'string',
				displayOptions: { show: { action: ['prompt'] } },
				default: '',
				placeholder: '123456789012345678',
				description: 'Only this user can click the buttons. Leave empty to allow anyone.',
			},
			{
				displayName: 'Delete Message After Response',
				name: 'deleteAfter',
				type: 'boolean',
				displayOptions: { show: { action: ['prompt'] } },
				default: false,
				description: 'Whether to delete the prompt message after a button is clicked',
			},
			{
				displayName: 'Timeout Message',
				name: 'timeoutMessage',
				type: 'string',
				displayOptions: { show: { action: ['prompt'] } },
				default: '',
				placeholder: 'No response received.',
				description: 'Optional message to send to the channel when the timeout is reached',
			},

			// ── Get messages ─────────────────────────────────────────────────────
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
				if (!guildId) return [{ name: '— select a server first —', value: '__none__' }];
				return fetchTextChannels(creds.token, guildId);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const creds = (await this.getCredentials('discordBotApi')) as DiscordCredentials;

		const confirmItems:  INodeExecutionData[] = [];
		const cancelItems:   INodeExecutionData[] = [];
		const timeoutItems:  INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const action    = this.getNodeParameter('action', i) as string;
			const channelId = this.getNodeParameter('channelId', i) as string;

			try {
				// ── sendMessage (REST only, no WS needed) ────────────────────────
				if (action === 'sendMessage') {
					const rest    = makeRest(creds.token);
					const content = this.getNodeParameter('messageContent', i) as string;
					const resp    = (await rest.post(Routes.channelMessages(channelId), { body: { content } })) as IDataObject;
					confirmItems.push({ json: { messageId: resp.id, channelId, content }, pairedItem: { item: i } });

				// ── getMessages (REST only) ───────────────────────────────────────
				} else if (action === 'getMessages') {
					const rest  = makeRest(creds.token);
					const limit = this.getNodeParameter('messagesLimit', i, 10) as number;
					const q     = new URLSearchParams();
					q.set('limit', String(limit));
					const msgs = (await rest.get(Routes.channelMessages(channelId), { query: q })) as IDataObject[];
					for (const msg of msgs) {
						confirmItems.push({
							json: {
								id:             msg.id,
								content:        msg.content,
								authorId:       (msg.author as IDataObject)?.id,
								authorUsername: (msg.author as IDataObject)?.username,
								timestamp:      msg.timestamp,
								channelId,
							},
							pairedItem: { item: i },
						});
					}

				// ── prompt (WebSocket needed to receive button interaction) ───────
				} else if (action === 'prompt') {
					const messageContent  = this.getNodeParameter('messageContent', i) as string;
					const confirmLabel    = this.getNodeParameter('confirmLabel', i, 'Confirm') as string;
					const cancelLabel     = this.getNodeParameter('cancelLabel', i, 'Cancel') as string;
					const timeoutSeconds  = this.getNodeParameter('timeoutSeconds', i, 30) as number;
					const allowedUserId   = this.getNodeParameter('allowedUserId', i, '') as string;
					const deleteAfter     = this.getNodeParameter('deleteAfter', i, false) as boolean;
					const timeoutMessage  = this.getNodeParameter('timeoutMessage', i, '') as string;

					const client = await getSharedClient(creds.token);

					try {
						// Fetch channel — tries cache first, falls back to API call
						const channel = await client.channels.fetch(channelId).catch(() => null);

						if (!channel) {
							throw new NodeOperationError(
								this.getNode(),
								`Channel ${channelId} not found. Ensure the bot is in this server and has access to this channel.`,
								{ itemIndex: i },
							);
						}

						if (!channel.isTextBased()) {
							throw new NodeOperationError(
								this.getNode(),
								`Channel ${channelId} is not a text channel.`,
								{ itemIndex: i },
							);
						}

						const textChannel = channel as TextBasedChannel;

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

						// Send the prompt
						if (!('send' in textChannel)) {
							throw new NodeOperationError(this.getNode(), `Cannot send to channel ${channelId}.`, { itemIndex: i });
						}

						const sendable = textChannel as TextChannel;
						const sentMessage = await sendable.send({
							content: messageContent,
							components: [row],
						});

						// Wait for button click
						let interaction: ButtonInteraction | null = null;
						try {
							interaction = await sentMessage.awaitMessageComponent({
								componentType: ComponentType.Button,
								time: timeoutSeconds * 1000,
								filter: allowedUserId
									? (intr) => intr.user.id === allowedUserId
									: undefined,
							});
						} catch {
							// Collector timed out — interaction stays null
						}

						// Build disabled row to replace active buttons
						const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
							ButtonBuilder.from(confirmBtn.toJSON()).setDisabled(true),
							ButtonBuilder.from(cancelBtn.toJSON()).setDisabled(true),
						);

						if (interaction) {
							// Acknowledge interaction within 3 s window
							await interaction.deferUpdate().catch(() => null);

							if (deleteAfter) {
								await sentMessage.delete().catch(() => null);
							} else {
								await sentMessage.edit({ components: [disabledRow] }).catch(() => null);
							}

							const responseData: IDataObject = {
								messageId:          sentMessage.id,
								channelId,
								prompt:             messageContent,
								respondedBy:        interaction.user.id,
								respondedByUsername: interaction.user.username,
								respondedAt:        interaction.createdTimestamp,
								choice: interaction.customId === 'discord_interaction_confirm' ? 'confirm' : 'cancel',
							};

							if (interaction.customId === 'discord_interaction_confirm') {
								confirmItems.push({ json: responseData, pairedItem: { item: i } });
							} else {
								cancelItems.push({ json: responseData, pairedItem: { item: i } });
							}

						} else {
							// Timeout — disable buttons and optionally send a message
							await sentMessage.edit({ components: [disabledRow] }).catch(() => null);

							if (timeoutMessage) {
								await sendable.send({ content: timeoutMessage }).catch(() => null);
							}

							timeoutItems.push({
								json: {
									messageId:      sentMessage.id,
									channelId,
									prompt:         messageContent,
									timedOut:       true,
									timeoutSeconds,
								},
								pairedItem: { item: i },
							});
						}

					} finally {
						releaseSharedClient(creds.token);
					}
				}

			} catch (error) {
				if (this.continueOnFail()) {
					timeoutItems.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [confirmItems, cancelItems, timeoutItems];
	}
}
