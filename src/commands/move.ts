import { Pipeline, defineCommand, InferSchemaTypes, DataObject } from '../framework/index';
import { inVoice, inSameVoice, performanceTimer } from '../middleware';
import { BotServices } from '../types';

const options = {
	from: {
		type: 'integer',
		description: 'The current position of the song (1-based)',
		required: true,
	},
	to: { type: 'integer', description: 'The new position for the song (1-based)', required: true },
} as const;

const movePipeline = new Pipeline<{}, InferSchemaTypes<typeof options>, BotServices>()
	.use(inVoice)
	.use(inSameVoice)
	.run(async (ctx) => {
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (!queue || queue.songs.length <= 1) {
			await ctx.reply(
				{
					embeds: [
						{
							description: '❌ There are not enough songs in the queue to move!',
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
			return;
		}

		const from = ctx.options.from;
		const to = ctx.options.to;
		const maxIndex = queue.songs.length - 1;

		if (from < 1 || from > maxIndex) {
			await ctx.reply(
				{
					embeds: [
						{
							description: `❌ Invalid "from" position! Must be between 1 and ${maxIndex}.`,
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
			return;
		}

		if (to < 1 || to > maxIndex) {
			await ctx.reply(
				{
					embeds: [
						{
							description: `❌ Invalid "to" position! Must be between 1 and ${maxIndex}.`,
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
			return;
		}

		if (from === to) {
			await ctx.reply(
				{
					embeds: [
						{
							description: '❌ The song is already at that position!',
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
			return;
		}

		try {
			const song = queue.songs[from];
			// Move the song in the array
			queue.songs.splice(from, 1);
			queue.songs.splice(to, 0, song);

			await ctx.reply({
				embeds: [
					{
						description: `🚚 Moved **${song.name}** from position **#${from}** to **#${to}**!`,
						color: 0x5865f2,
					},
				],
			});
		} catch (error) {
			await ctx.reply(
				{
					embeds: [
						{
							description: `❌ Failed to move song: ${(error as Error).message}`,
							color: 0xff3333,
						},
					],
				},
				{ ping: false },
			);
		}
	});

export const moveCommand = defineCommand<DataObject, BotServices, typeof options>({
	name: 'move',
	description: 'Changes the queue position of a song',
	options,
	pipeline: movePipeline,
});
