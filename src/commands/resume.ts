import { Pipeline, defineCommand, DataObject } from '../framework/index';
import { inVoice, inSameVoice, performanceTimer } from '../middleware';
import { BotServices } from '../types';

const resumePipeline = new Pipeline<{}, Record<string, never>, BotServices>()
	.use(inVoice)
	.use(inSameVoice)
	.run(async (ctx) => {
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (!queue) {
			await ctx.reply(
				{
					embeds: [
						{
							description: '❌ There is no active queue!',
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
			return;
		}

		if (!queue.paused) {
			await ctx.reply(
				{
					embeds: [
						{
							description: '▶️ The playback is already playing!',
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
			return;
		}

		try {
			await queue.resume();
			await ctx.reply({
				embeds: [
					{
						description: '▶️ Resumed the music.',
						color: 0x5865f2,
					},
				],
			});
		} catch (error) {
			await ctx.reply(
				{
					embeds: [
						{
							description: `❌ Failed to resume: ${(error as Error).message}`,
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
		}
	});

export const resumeCommand = defineCommand<DataObject, BotServices, {}>({
	name: 'resume',
	description: 'Resumes the paused song',
	pipeline: resumePipeline,
});
