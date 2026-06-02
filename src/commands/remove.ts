import { Pipeline, defineCommand, InferSchemaTypes, DataObject } from '../framework/index';
import { inVoice, inSameVoice, performanceTimer } from '../middleware';
import { BotServices } from '../types';

const options = {
	index: {
		type: 'integer',
		description: 'The absolute index (#) of the song to remove from the queue',
		required: true,
	},
} as const;

const removePipeline = new Pipeline<{}, InferSchemaTypes<typeof options>, BotServices>()
	.use(inVoice)
	.use(inSameVoice)
	.run(async (ctx) => {
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (!queue || queue.songs.length === 0) {
			await ctx.reply('❌ There is no active music queue!', { ping: false });
			return;
		}

		const allSongs = [...queue.history, ...queue.songs];
		const currentIndex = queue.history.length;
		const targetIndex = ctx.options.index;

		if (targetIndex < 1 || targetIndex > allSongs.length) {
			await ctx.reply(`❌ Invalid index! Must be between 1 and ${allSongs.length}.`, {
				ping: false,
			});
			return;
		}

		const zeroIndex = targetIndex - 1;

		if (zeroIndex === currentIndex) {
			await ctx.reply('❌ Cannot remove the currently playing song! Use `skip` to skip it.', {
				ping: false,
			});
			return;
		}

		try {
			if (zeroIndex < currentIndex) {
				const [removedSong] = queue.history.splice(zeroIndex, 1);
				await ctx.reply(`🗑️ Removed **${removedSong.name}** from the queue history.`);
			} else {
				// Calculate index in queue.songs
				const songIndexInQueue = zeroIndex - currentIndex;
				const [removedSong] = queue.songs.splice(songIndexInQueue, 1);
				await ctx.reply(`🗑️ Removed **${removedSong.name}** from the queue.`);
			}
		} catch (error) {
			await ctx.reply(`❌ Failed to remove song: ${(error as Error).message}`, { ping: false });
		}
	});

export const removeCommand = defineCommand<DataObject, BotServices, typeof options>({
	name: 'remove',
	description: 'Removes a specific song from the queue by its index',
	aliases: ['rm', 'delete'],
	options,
	pipeline: removePipeline,
});
