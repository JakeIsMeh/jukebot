import { Pipeline, defineCommand, DataObject } from '../framework/index';
import { inVoice } from '../middleware';
import { BotServices } from '../types';

const joinPipeline = new Pipeline<{}, Record<string, never>, BotServices>()
	.use(inVoice)
	.run(async (ctx) => {
		const targetChannel = ctx.data.voiceChannel;
		const botVoiceChannel = ctx.member?.guild.members.me?.voice.channel;

		// Case A: Bot is not currently in any voice channel in this guild
		if (!botVoiceChannel) {
			try {
				await ctx.services.player.voices.join(targetChannel);
				// Clear any pending idle timer — the bot now has a home again
				ctx.services.queueTimers.clear(ctx.member!.guild.id);
				await ctx.reply({
					embeds: [
						{
							description: `✅ Joined **${targetChannel.name}**!`,
							color: 0x5865f2,
						},
					],
				});
			} catch (error) {
				await ctx.reply(
					{
						embeds: [
							{
								description: `❌ Failed to join voice channel: ${(error as Error).message}`,
								color: 0xff3333,
							},
						],
					},
					{ ping: false },
				);
			}
			return;
		}

		// Case B: Bot is already in a voice channel in this guild
		if (botVoiceChannel.id === targetChannel.id) {
			await ctx.reply(
				{
					embeds: [
						{
							description: `ℹ️ I am already in your voice channel!`,
							color: 0x5865f2,
						},
					],
				},
				{ ping: false },
			);
			return;
		}

		// Check if we are allowed to move:
		// 1. Current channel is empty of other human users
		const humansInChannel = botVoiceChannel.members.filter((m) => !m.user.bot);
		const isCurrentChannelEmpty = humansInChannel.size === 0;

		// 2. Or there are no songs queued/playing
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		const isQueueEmpty = !queue || queue.songs.length === 0;

		if (isCurrentChannelEmpty || isQueueEmpty) {
			try {
				await ctx.services.player.voices.join(targetChannel);
				// Clear any pending idle timer — bot has been re-summoned
				ctx.services.queueTimers.clear(ctx.member!.guild.id);
				await ctx.reply({
					embeds: [
						{
							description: `🚚 Moved from **${botVoiceChannel.name}** to **${targetChannel.name}**!`,
							color: 0x5865f2,
						},
					],
				});
			} catch (error) {
				await ctx.reply(
					{
						embeds: [
							{
								description: `❌ Failed to move to voice channel: ${(error as Error).message}`,
								color: 0xff3333,
							},
						],
					},
					{ ping: false },
				);
			}
		} else {
			await ctx.reply(
				{
					embeds: [
						{
							description: `❌ I am currently playing music for active listeners in **${botVoiceChannel.name}**!`,
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
		}
	});

export const joinCommand = defineCommand<DataObject, BotServices, {}>({
	name: 'join',
	description: 'Joins or moves into your voice channel',
	pipeline: joinPipeline,
});
