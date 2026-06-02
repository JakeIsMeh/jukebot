import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';

import { joinCommand } from './commands/join';
import { jumpCommand } from './commands/jump';
import { leaveCommand } from './commands/leave';
import { moveCommand } from './commands/move';
import { nowplayingCommand } from './commands/nowplaying';
import { pauseCommand } from './commands/pause';
import { playCommand } from './commands/play';
import { queueCommand } from './commands/queue';
import { removeCommand } from './commands/remove';
import { resumeCommand } from './commands/resume';
import { skipCommand } from './commands/skip';
import { stopCommand } from './commands/stop';
import { volumeCommand } from './commands/volume';
import { Framework, helpCommand } from './framework/index';
import { rootLogger } from './framework/logger';
import { MusicPlayerManager, queueTimerManager } from './services/MusicPlayer';
import { BotServices } from './types';

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.MessageContent,
	],
});

const player = new MusicPlayerManager();

const app: Framework<BotServices> = new Framework<BotServices>({ prefix: 'jb.' })
	.provide('player', player)
	.provide('queueTimers', queueTimerManager);

app
	.command(playCommand)
	.command(skipCommand)
	.command(stopCommand)
	.command(pauseCommand)
	.command(resumeCommand)
	.command(queueCommand)
	.command(volumeCommand)
	.command(jumpCommand)
	.command(nowplayingCommand)
	.command(moveCommand)
	.command(joinCommand)
	.command(leaveCommand)
	.command(removeCommand)
	.command(helpCommand as any);

client.on('interactionCreate', (interaction) => app.handleInteraction(interaction));
client.on('messageCreate', (message) => app.handleMessage(message));

client.on('voiceStateUpdate', async (oldState, newState) => {
	const guildId = oldState.guild.id;
	const guildPlayer = player.getQueue(guildId);
	if (!guildPlayer) return;

	const isBotStateChange = newState.member?.user.id === oldState.guild.members.me?.id;

	// Handle the bot itself being moved to a new channel (e.g. by a moderator via Discord UI)
	if (isBotStateChange) {
		const botMovedToNewChannel =
			oldState.channelId !== null &&
			newState.channelId !== null &&
			oldState.channelId !== newState.channelId;

		if (botMovedToNewChannel && newState.channel) {
			const humansInNewChannel = newState.channel.members.filter((m) => !m.user.bot);
			if (humansInNewChannel.size > 0) {
				rootLogger.info(
					`🚚 Bot was moved to a new channel in guild ${guildId} with listeners present. Clearing idle timer.`,
				);
				queueTimerManager.clear(guildId);
				// Resume playback if it was paused due to an empty channel
				if (!guildPlayer.playing && guildPlayer.songs.length > 0) {
					await guildPlayer.resume();
				}
			}
		}
		return;
	}

	// --- User voice state changes below ---

	const botVoiceChannel = oldState.guild.members.me?.voice.channel;
	if (!botVoiceChannel) return;

	const wasInBotChannel = oldState.channelId === botVoiceChannel.id;
	const isInBotChannel = newState.channelId === botVoiceChannel.id;

	if (wasInBotChannel && !isInBotChannel) {
		const humansInChannel = botVoiceChannel.members.filter((m) => !m.user.bot);
		if (humansInChannel.size === 0) {
			rootLogger.info(
				`👥 All users left the voice channel in guild ${guildId}. Pausing playback and starting idle timer.`,
			);

			if (guildPlayer.songs.length > 0) {
				if (guildPlayer.playing) {
					await guildPlayer.pause();
					if (guildPlayer.textChannel) {
						guildPlayer.textChannel
							.send({
								content: '⏸️ Playback paused because all users left the voice channel.',
								flags: [MessageFlags.SuppressNotifications],
							})
							.catch(() => {});
					}
				}
				queueTimerManager.start(guildId, guildPlayer.textChannel, guildPlayer);
			}
		}
	} else if (!wasInBotChannel && isInBotChannel) {
		const humansInChannel = botVoiceChannel.members.filter((m) => !m.user.bot);
		if (humansInChannel.size > 0) {
			rootLogger.info(
				`👥 Users returned to the voice channel in guild ${guildId}. Clearing idle timer.`,
			);
			queueTimerManager.clear(guildId);
		}
	}
});

client.once('clientReady', async (readyClient) => {
	rootLogger.info(`Logged in as ${readyClient.user.tag}`);

	try {
		const CLIENT_ID = readyClient.user.id;
		const GUILD_ID = process.env.DEV_GUILD_ID;

		rootLogger.info('🔄 Syncing slash commands...');
		const count = await app.syncCommands(
			process.env.DISCORD_TOKEN!,
			CLIENT_ID,
			GUILD_ID,
			!!GUILD_ID,
		);
		rootLogger.info(`✅ Successfully registered ${count} commands!`);
	} catch (err) {
		rootLogger.error('❌ Failed to sync commands', {}, err as Error);
	}
});

await client.login(process.env.DISCORD_TOKEN);
rootLogger.info('Bot Online');
