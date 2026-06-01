import { Pipeline, defineCommand, DataObject } from '../framework/index';
import { inVoice, inSameVoice, performanceTimer } from '../middleware';
import { BotServices } from '../types';

const pausePipeline = new Pipeline<{}, Record<string, never>, BotServices>()
	.use(performanceTimer)
	.use(inVoice)
	.use(inSameVoice)
	.run(async (ctx) => {
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (!queue || !queue.playing) {
			await ctx.reply(
				{
					embeds: [
						{
							description: '❌ There is nothing playing right now!',
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
			return;
		}

		if (queue.paused) {
			await ctx.reply(
				{
					embeds: [
						{
							description: '⏸️ The playback is already paused!',
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
			return;
		}

		try {
			await queue.pause();
			await ctx.reply({
				embeds: [
					{
						description: '⏸️ Paused the music.',
						color: 0x5865f2,
					},
				],
			});
		} catch (error) {
			await ctx.reply(
				{
					embeds: [
						{
							description: `❌ Failed to pause: ${(error as Error).message}`,
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
		}
	});

export const pauseCommand = defineCommand<DataObject, BotServices, {}>({
	name: 'pause',
	description: 'Pauses the currently playing song',
	pipeline: pausePipeline,
});
