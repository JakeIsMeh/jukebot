import { Pipeline, defineCommand, InferSchemaTypes, DataObject } from '../framework/index';
import { inVoice, inSameVoice } from '../middleware';
import { BotServices } from '../types';

const options = {
	volume: { type: 'integer', description: 'Volume level (0-100)', required: false },
} as const;

const volumePipeline = new Pipeline<{}, InferSchemaTypes<typeof options>, BotServices>()
	.use(inVoice)
	.use(inSameVoice)
	.run(async (ctx) => {
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (!queue) {
			await ctx.reply({
				embeds: [{ description: '❌ There is no active music queue!', color: 0xe74c3c }],
			});
			return;
		}

		const newVolume = ctx.options.volume;
		if (newVolume === undefined) {
			await ctx.reply({
				embeds: [
					{
						description: `🔊 Current volume: **${queue.volume}%**`,
						color: 0x5865f2,
					},
				],
			});
			return;
		}

		if (newVolume < 0 || newVolume > 100) {
			await ctx.reply({
				embeds: [{ description: '❌ Volume must be between 0 and 100!', color: 0xe74c3c }],
			});
			return;
		}

		try {
			queue.setVolume(newVolume);
			await ctx.reply({
				embeds: [
					{
						description: `🔊 Volume set to **${newVolume}%**`,
						color: 0x5865f2,
					},
				],
			});
		} catch (error) {
			await ctx.reply({
				embeds: [
					{
						description: `❌ Failed to set volume: ${(error as Error).message}`,
						color: 0xe74c3c,
					},
				],
			});
		}
	});

export const volumeCommand = defineCommand<DataObject, BotServices, typeof options>({
	name: 'volume',
	description: 'Changes or displays the music volume',
	aliases: ['vol'],
	options,
	pipeline: volumePipeline,
});
