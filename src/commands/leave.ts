import { Pipeline, defineCommand, DataObject } from '../framework/index';
import { performanceTimer } from '../middleware';
import { BotServices } from '../types';

const leavePipeline = new Pipeline<{}, Record<string, never>, BotServices>().run(async (ctx) => {
	const botMember = ctx.member?.guild.members.me;
	const botVoiceChannel = botMember?.voice.channel;

	if (!botVoiceChannel) {
		await ctx.reply(
			{
				embeds: [
					{
						description: '❌ I am not in a voice channel!',
						color: 0xff3333,
					},
				],
			},
			{ ping: false },
		);
		return;
	}

	// Count human members in the bot's voice channel
	const humansInChannel = botVoiceChannel.members.filter((m) => !m.user.bot);
	const isAlone = humansInChannel.size === 0;

	// Prevent griefing: if not alone, the user must be in the same voice channel
	if (!isAlone) {
		const userVoiceChannel = ctx.member?.voice.channel;
		if (!userVoiceChannel || userVoiceChannel.id !== botVoiceChannel.id) {
			await ctx.reply(
				{
					embeds: [
						{
							description:
								'❌ You must be in my voice channel to ask me to leave while others are listening!',
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
			return;
		}
	}

	try {
		// Stop active queue if one exists
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (queue) {
			await queue.stop();
		}

		// Clear active empty queue timer if one exists
		ctx.services.queueTimers.clear(ctx.member!.guild.id);

		// Disconnect from voice channel
		ctx.services.player.voices.leave(ctx.member!.guild.id);
		await ctx.reply({
			embeds: [
				{
					description: `👋 Disconnected from **${botVoiceChannel.name}**!`,
					color: 0x5865f2,
				},
			],
		});
	} catch (error) {
		await ctx.reply(
			{
				embeds: [
					{
						description: `❌ Failed to leave voice channel: ${(error as Error).message}`,
						color: 0xff3333,
					},
				],
			},
			{ ping: false },
		);
	}
});

export const leaveCommand = defineCommand<DataObject, BotServices, {}>({
	name: 'leave',
	description: 'Disconnects the bot from the voice channel',
	aliases: ['disconnect'],
	pipeline: leavePipeline,
});
