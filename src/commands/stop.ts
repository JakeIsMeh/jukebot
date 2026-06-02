import { Pipeline, defineCommand, DataObject } from '../framework/index';
import { performanceTimer } from '../middleware';
import { BotServices } from '../types';

const stopPipeline = new Pipeline<{}, Record<string, never>, BotServices>().run(async (ctx) => {
	const botMember = ctx.member?.guild.members.me;
	const botVoiceChannel = botMember?.voice.channel;

	if (!botVoiceChannel) {
		await ctx.reply({
			embeds: [{ description: '❌ I am not in a voice channel!', color: 0xe74c3c }],
		});
		return;
	}

	// Count human members in the bot's voice channel
	const humansInChannel = botVoiceChannel.members.filter((m) => !m.user.bot);
	const isAlone = humansInChannel.size === 0;

	// Prevent griefing: if not alone, the user must be in the same voice channel
	if (!isAlone) {
		const userVoiceChannel = ctx.member?.voice.channel;
		if (!userVoiceChannel || userVoiceChannel.id !== botVoiceChannel.id) {
			await ctx.reply({
				embeds: [
					{
						description:
							'❌ You must be in my voice channel to stop me while others are listening!',
						color: 0xe74c3c,
					},
				],
			});
			return;
		}
	}

	try {
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (!queue) {
			await ctx.reply({
				embeds: [{ description: '❌ There is nothing playing right now!', color: 0xe74c3c }],
			});
			return;
		}
		await queue.stop();
		await ctx.reply({
			embeds: [
				{
					description: '🛑 Playback stopped and queue cleared!',
					color: 0x5865f2,
				},
			],
		});

		// Start empty queue timer
		ctx.services.queueTimers.start(ctx.member!.guild.id, ctx.channel, ctx.services.player);
	} catch (error) {
		await ctx.reply({
			embeds: [
				{
					description: `❌ Failed to stop: ${(error as Error).message}`,
					color: 0xe74c3c,
				},
			],
		});
	}
});

export const stopCommand = defineCommand<DataObject, BotServices, {}>({
	name: 'stop',
	description: 'Stops playback and clears the music queue',
	aliases: ['clearqueue'],
	pipeline: stopPipeline,
});
