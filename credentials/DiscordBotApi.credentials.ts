import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class DiscordBotApi implements ICredentialType {
	name = 'discordBotApi';
	displayName = 'Discord Bot API';
	documentationUrl = 'https://discord.com/developers/docs/intro';

	properties: INodeProperties[] = [
		{
			displayName: 'Bot Token',
			name: 'token',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Bot token from the Discord Developer Portal → your application → Bot → Token. ' +
				'Enable "Message Content Intent" under Privileged Gateway Intents for the trigger node to read message content.',
		},
		{
			displayName: 'Application ID',
			name: 'applicationId',
			type: 'string',
			required: true,
			default: '',
			description: 'Application ID from the Discord Developer Portal → your application → General Information.',
		},
	];
}
