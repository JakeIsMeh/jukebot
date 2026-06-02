import {
	Pipeline,
	defineCommand,
	defineSubcommand,
	InferSchemaTypes,
	DataObject,
} from '../framework/index';
import { inVoice, inSameVoice, performanceTimer } from '../middleware';
import { BotServices } from '../types';

// Options for absolute jump (default)
const absoluteOptions = {
	index: {
		type: 'integer',
		description: 'The absolute index (#) of the song to jump to from the queue',
		required: true,
	},
} as const;

// Options for relative jump subcommand
const relativeOptions = {
	offset: {
		type: 'integer',
		description: 'The relative offset (negative for past songs, positive for upcoming songs)',
		required: true,
	},
} as const;

const absolutePipeline = new Pipeline<{}, InferSchemaTypes<typeof absoluteOptions>, BotServices>()
	.use(inVoice)
	.use(inSameVoice)
	.run(async (ctx) => {
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (!queue || !queue.isPlaying) {
			await ctx.reply('❌ There is nothing playing right now!', { ping: false });
			return;
		}

		const allSongs = [...queue.history, ...queue.songs];
		const currentIndex = queue.history.length; // index in allSongs
		const targetIndex = ctx.options.index; // 1-based absolute index

		if (targetIndex < 1 || targetIndex > allSongs.length) {
			await ctx.reply(`❌ Invalid index! Must be between 1 and ${allSongs.length}.`, {
				ping: false,
			});
			return;
		}

		const relativeOffset = targetIndex - (currentIndex + 1);

		if (relativeOffset === 0) {
			await ctx.reply('❌ Cannot jump to the currently playing song!', { ping: false });
			return;
		}

		try {
			const targetSong = await queue.jump(relativeOffset);
			await ctx.reply(`⏭️ Jumped to absolute index **#${targetIndex}**: **${targetSong.name}**!`);
		} catch (error) {
			await ctx.reply(`❌ Failed to jump: ${(error as Error).message}`, { ping: false });
		}
	});

const relativeSubcommand = defineSubcommand<DataObject, BotServices, typeof relativeOptions>({
	name: 'relative',
	aliases: ['r'],
	description: 'Jumps by a relative offset (e.g. -2 to go back 2 songs, +3 to skip 3 songs)',
	options: relativeOptions,
	pipeline: new Pipeline<{}, InferSchemaTypes<typeof relativeOptions>, BotServices>()
		.use(performanceTimer)
		.use(inVoice)
		.use(inSameVoice)
		.run(async (ctx) => {
			const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
			if (!queue || !queue.isPlaying) {
				await ctx.reply('❌ There is nothing playing right now!', { ping: false });
				return;
			}

			const offset = ctx.options.offset;

			if (offset === 0) {
				await ctx.reply('❌ Cannot jump by offset 0 (the currently playing song)!', {
					ping: false,
				});
				return;
			}

			try {
				const targetSong = await queue.jump(offset);
				const offsetStr = offset > 0 ? `+${offset}` : `${offset}`;
				await ctx.reply(
					`⏭️ Jumped by relative offset **${offsetStr}** to: **${targetSong.name}**!`,
				);
			} catch (error) {
				await ctx.reply(`❌ Failed to jump: ${(error as Error).message}`, { ping: false });
			}
		})!,
});

export const jumpCommand = defineCommand<DataObject, BotServices, typeof absoluteOptions>({
	name: 'jump',
	description: 'Jumps to a specific absolute index in the history or queue',
	aliases: ['goto', 'j'],
	options: absoluteOptions,
	subcommands: [relativeSubcommand],
	defaultSubcommand: 'absolute',
	pipeline: absolutePipeline,
});
