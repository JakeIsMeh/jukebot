import { Pipeline, defineCommand, DataObject } from '../framework/index';
import { inVoice, inSameVoice, performanceTimer } from '../middleware';
import { BotServices } from '../types';

const skipPipeline = new Pipeline<{}, Record<string, never>, BotServices>()
	.use(performanceTimer)
	.use(inVoice)
	.use(inSameVoice)
	.run(async (ctx) => {
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (!queue || !queue.playing) {
			await ctx.reply({
				embeds: [{ description: '❌ There is nothing playing right now!', color: 0xe74c3c }],
			});
			return;
		}

		if (queue.songs.length <= 1 && !queue.autoplay) {
			await queue.stop();
			await ctx.reply({
				embeds: [
					{
						description: '⏭️ Skipped! The queue is now empty.',
						color: 0x5865f2,
					},
				],
			});
			ctx.services.queueTimers.start(ctx.member!.guild.id, ctx.channel, ctx.services.player);
		} else {
			try {
				const song = await queue.skip();
				await ctx.reply({
					embeds: [
						{
							title: '⏭️ Skipped',
							description: `Now playing: **[${song.name}](${song.url})**`,
							thumbnail: song.thumbnail ? { url: song.thumbnail } : undefined,
							color: 0x5865f2,
						},
					],
				});
			} catch (error) {
				await ctx.reply({
					embeds: [
						{
							description: `❌ Failed to skip: ${(error as Error).message}`,
							color: 0xe74c3c,
						},
					],
				});
			}
		}
	});

export const skipCommand = defineCommand<DataObject, BotServices, {}>({
	name: 'skip',
	description: 'Skips the current song',
	pipeline: skipPipeline,
});
