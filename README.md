# n8n-nodes-discord-lisboa

[![npm version](https://img.shields.io/npm/v/n8n-nodes-discord-lisboa)](https://www.npmjs.com/package/n8n-nodes-discord-lisboa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-oRadiatorExtrem-181717?logo=github)](https://github.com/oRadiatorExtrem/n8n-nodes-discord-lisboa)

**n8n community nodes for Discord** — triggers, actions and interactive prompts built on [discord.js v14](https://discord.js.org/) and Discord API v10.

Built to solve the persistent issues found in other Discord n8n packages:

| Problem in other packages | How this package fixes it |
|---|---|
| IPC / separate bot process — fragile on Linux/Windows, zombie processes, 15 s timeouts | No IPC. discord.js runs directly inside n8n's process. |
| New WebSocket client created per workflow execution | Singleton client pool — one connection per token, shared across all nodes. |
| `message.content` always empty | `MessageContent` privileged intent declared explicitly. |
| Memory leaks when deactivating workflows | Event listeners removed by reference in `closeFunction`. |
| Deprecated API endpoints (Discord API v6/v8) | All calls use Discord API v10 (default in discord.js v14). |
| No proper UI — channel/role IDs entered manually | Dropdowns populated live from Discord REST API. |

---

## Nodes included

### Discord Trigger
Starts a workflow when a Discord event occurs. Uses a persistent WebSocket connection (Gateway). Supported event types:

- **New Message** — with pattern matching (any, @bot mention, contains, starts with, ends with, exact, regex)
- **Message Updated**
- **Message Deleted**
- **Reaction Added / Removed**
- **Member Joined / Left / Updated**
- **Role Created / Deleted / Updated**
- **Voice State Changed** (user joins, leaves, mutes, etc.)
- **Scheduled Event Created / Updated**

All trigger types support filtering by server, channel (multi-select), role (multi-select), and user ID.

### Discord Action
Performs Discord actions. Pure REST — no WebSocket required. Supported operations:

- **Send Message** — plain text, optional reply-to
- **Send Embed** — title, description, color, image, thumbnail, footer, author, fields
- **Edit Message**
- **Delete Message**
- **Add / Remove Reaction**
- **Get Messages** — fetch recent messages from a channel (with pagination)
- **Create Channel** — text, voice, announcement, or forum; optional category and topic
- **Delete Channel**
- **Create Scheduled Event** — external, voice, or stage; configurable start/end time and location
- **Delete Scheduled Event**
- **Get Guild Info**

### Discord Interaction
Sends a message with **Confirm / Cancel buttons** and waits for a user to click one. Produces three output branches:

- **Confirm** — user clicked the confirm button
- **Cancel** — user clicked the cancel button
- **No Response** — timeout elapsed without a click

Configurable: button labels, timeout (5–300 s), restrict to a specific user, optionally delete the prompt message after a response.

---

## Prerequisites

### 1. Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Navigate to **Bot** → **Add Bot**
3. Copy the **Bot Token** (keep this secret)
4. Copy the **Application ID** from **General Information**

### 2. Enable Privileged Gateway Intents

Still in the **Bot** tab, scroll to **Privileged Gateway Intents** and enable all three:

- **Server Members Intent**
- **Presence Intent**
- **Message Content Intent** ← required for reading message text

Without these, the trigger fires but `content` will be empty and member-based filters won't work.

### 3. Invite the Bot to Your Server

Use this URL (replace `YOUR_APP_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=8&scope=bot
```

`permissions=8` is Administrator. For a minimal setup, use the specific permissions your bot needs (Send Messages = `2048`, Add Reactions = `64`, Manage Channels = `16`, etc.).

### 4. Get Your Server (Guild) ID

In Discord: **Settings → Advanced → Developer Mode** (enable it).  
Then right-click your server name → **Copy Server ID**.

---

## Installation

### Via n8n Community Nodes UI (recommended)

1. In n8n: **Settings → Community Nodes → Install**
2. Enter `n8n-nodes-discord-lisboa`
3. Click Install and restart n8n

### Manual (self-hosted, no npm publish)

```bash
# On your VPS, set the custom extensions directory in n8n's environment:
# N8N_CUSTOM_EXTENSIONS=/home/user/.n8n/custom

mkdir -p /home/user/.n8n/custom
cd /home/user/.n8n/custom

# Clone or copy the built package, then:
npm install n8n-nodes-discord-lisboa
```

Or if installing from source:

```bash
git clone <your-repo>
cd n8n-nodes-discord-lisboa
npm install
npm run build
# Copy dist/ into your n8n custom extensions path
```

---

## Configuration

### Credential: Discord Bot API

In n8n: **Credentials → New → Discord Bot API**

| Field | Where to find it |
|---|---|
| Bot Token | Discord Dev Portal → your app → **Bot → Token** |
| Application ID | Discord Dev Portal → your app → **General Information → Application ID** |

---

## Usage

### Discord Trigger — example: respond to messages starting with `!`

1. Add a **Discord Trigger** node
2. Set **Credential** to your Discord Bot API credential
3. Set **Trigger Type** → `New Message`
4. Set **Message Pattern** → `Starts with` / **Pattern Value** → `!`
5. Set **Server** → select your server from the dropdown
6. Set **Channels** → select one or more channels (or leave empty for all)
7. Activate the workflow — the bot connects and starts listening

Output fields include: `id`, `content`, `authorId`, `authorUsername`, `channelId`, `guildId`, `timestamp`, `attachments`, `mentionedUsers`, `messageUrl`.

### Discord Action — example: send a message

1. Add a **Discord Action** node
2. Set **Operation** → `Send Message`
3. Set **Channel ID** → paste the channel ID (right-click channel in Discord → Copy Channel ID)
4. Set **Message Content** → `Hello from n8n!`

### Discord Interaction — example: confirmation prompt

1. Add a **Discord Interaction** node
2. Set **Action** → `Send Prompt (with Confirm/Cancel)`
3. Set **Channel ID** and **Message** → `Are you sure you want to proceed?`
4. Connect the three output branches: **Confirm** → next action, **Cancel** → stop, **No Response** → handle timeout

---

## Architecture notes

The `DiscordTrigger` node establishes a WebSocket connection to the Discord Gateway using [discord.js](https://discord.js.org/) when the workflow is activated. Multiple trigger nodes sharing the same bot token share a single connection (singleton pool keyed by token). The connection is destroyed only when all trigger nodes using that token are deactivated.

The `DiscordAction` and `DiscordInteraction` (Send Message / Get Messages) nodes use Discord's REST API exclusively — no WebSocket connection needed for outgoing actions.

The `DiscordInteraction` prompt action reuses the shared WebSocket client to receive button interaction events.

---

## Troubleshooting

**`content` is always empty**  
→ Enable **Message Content Intent** in the Discord Developer Portal under your bot's settings.

**Channels / Roles dropdowns show "select a server first"**  
→ Select a server in the **Server** dropdown first. Channels and roles depend on the server selection.

**Bot connects but no events arrive**  
→ Confirm the bot is a member of the server. Confirm the **Server** filter in the trigger matches your server's ID.

**`DiscordInteraction` times out immediately**  
→ The bot needs to be in the channel where the message is sent. Confirm the channel ID is correct.

**`Cannot read properties of undefined (reading 'bot')`**  
→ The message is partial (not cached). Ensure the `MessageContent` and `GuildMessages` intents are enabled.

---

## Updating

When a new version is released:
- Via n8n UI: **Settings → Community Nodes** → update button next to the package
- Via npm: `npm update n8n-nodes-discord-lisboa` in your n8n custom extensions directory, then restart n8n

---

## License

MIT — see [LICENSE](LICENSE)

---

*Built by [karluz](https://github.com/oRadiatorExtrem). Contributions welcome via [GitHub Issues](https://github.com/oRadiatorExtrem/n8n-nodes-discord-lisboa/issues).*
