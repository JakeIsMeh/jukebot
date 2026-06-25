import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';

import { Pipeline, defineCommand, defineSubcommand, DataObject } from '../framework/index';
import { inVoice, inSameVoice, performanceTimer } from '../middleware';
import { BotServices } from '../types';

const queuePipeline = new Pipeline<{}, Record<string, never>, BotServices>().run(async (ctx) => {
	const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
	if (!queue || (queue.songs.length === 0 && queue.history.length === 0)) {
		await ctx.reply(
			{
				embeds: [
					{
						description: '📭 The queue is currently empty!',
						color: 0x5865f2,
					},
				],
			},
			{ ping: false },
		);
		return;
	}

	const allSongs = [...queue.history, ...queue.songs];
	const currentIndex = queue.history.length;
	const itemsPerPage = 10;
	const totalPages = Math.ceil(allSongs.length / itemsPerPage);

	// Default to the page containing the current playing song
	let currentPage = Math.floor(currentIndex / itemsPerPage);

	const getEmbedAndComponents = (pageIndex: number) => {
		const start = pageIndex * itemsPerPage;
		const end = Math.min(allSongs.length, (pageIndex + 1) * itemsPerPage);
		const chunk = allSongs.slice(start, end);

		let description = '';
		chunk.forEach((song, idx) => {
			const absoluteIndex = start + idx;
			const displayIdx = absoluteIndex + 1;
			if (absoluteIndex < currentIndex) {
				// Past Song
				description += `⏮️ **#${displayIdx}.** *[${song.name}](${song.url})* - \`${song.formattedDuration}\` (Requested by: ${song.user?.username ?? 'Unknown'})\n`;
			} else if (absoluteIndex === currentIndex) {
				// Now Playing
				description += `▶️ **Now Playing (#${displayIdx}):** **[${song.name}](${song.url})** - \`${song.formattedDuration}\` (Requested by: ${song.user?.username ?? 'Unknown'})\n`;
			} else {
				// Upcoming Song
				description += `⏭️ **#${displayIdx}.** [${song.name}](${song.url}) - \`${song.formattedDuration}\` (Requested by: ${song.user?.username ?? 'Unknown'})\n`;
			}
		});

		const embed = {
			title: `Music Queue for ${ctx.member!.guild.name}`,
			description: description || '*Empty page*',
			color: 0x5865f2,
			footer: {
				text: `Page ${pageIndex + 1} of ${totalPages} | Loop mode: ${queue.repeatMode === 0 ? 'Off' : queue.repeatMode === 1 ? 'Song' : 'Queue'} | Autoplay: ${queue.autoplay ? 'On' : 'Off'}`,
			},
		};

		if (totalPages <= 1) {
			return { embeds: [embed], components: [] };
		}

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('queue_prev')
				.setLabel('◀️ Previous')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(pageIndex === 0),
			new ButtonBuilder()
				.setCustomId('queue_next')
				.setLabel('Next ▶️')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(pageIndex === totalPages - 1),
		);

		return { embeds: [embed], components: [row] };
	};

	const payload = getEmbedAndComponents(currentPage);
	const message = await ctx.reply(payload);

	if (totalPages > 1) {
		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60000,
		});

		collector.on('collect', async (interaction) => {
			if (interaction.user.id !== ctx.author.id) {
				await interaction.reply({
					embeds: [
						{
							description:
								'❌ Only the user who requested this queue display can use the pagination buttons.',
							color: 0xff3333,
						},
					],
					ephemeral: true,
				});
				return;
			}

			if (interaction.customId === 'queue_prev') {
				currentPage = Math.max(0, currentPage - 1);
			} else if (interaction.customId === 'queue_next') {
				currentPage = Math.min(totalPages - 1, currentPage + 1);
			}

			await interaction.update(getEmbedAndComponents(currentPage));
		});

		collector.on('end', async () => {
			const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId('queue_prev')
					.setLabel('◀️ Previous')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(true),
				new ButtonBuilder()
					.setCustomId('queue_next')
					.setLabel('Next ▶️')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(true),
			);

			try {
				await message.edit({ components: [disabledRow] });
			} catch {
				// Message might have been deleted
			}
		});
	}
});

const clearSubcommand = defineSubcommand<DataObject, BotServices, {}>({
	name: 'clear',
	description: 'Clears all upcoming songs from the queue',
	pipeline: new Pipeline<{}, Record<string, never>, BotServices>()
		.use(performanceTimer)
		.use(inVoice)
		.use(inSameVoice)
		.run(async (ctx) => {
			const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
			if (!queue || queue.songs.length <= 1) {
				await ctx.reply(
					{
						embeds: [
							{
								description: '❌ The queue is already empty!',
								color: 0xff3333,
							},
						],
					},
					{ ping: false },
				);
				return;
			}

			try {
				queue.songs.splice(1);
				await ctx.reply({
					embeds: [
						{
							description: '🗑️ Cleared all upcoming songs from the queue!',
							color: 0x5865f2,
						},
					],
				});
			} catch (error) {
				await ctx.reply(
					{
						embeds: [
							{
								description: `❌ Failed to clear queue: ${(error as Error).message}`,
								color: 0xff3333,
							},
						],
					},
					{ ping: false },
				);
			}
		})!,
});

const shuffleSubcommand = defineSubcommand<DataObject, BotServices, {}>({
	name: 'shuffle',
	description: 'Shuffles all upcoming songs in the queue',
	pipeline: new Pipeline<{}, Record<string, never>, BotServices>()
		.use(performanceTimer)
		.use(inVoice)
		.use(inSameVoice)
		.run(async (ctx) => {
			const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
			if (!queue || queue.songs.length <= 2) {
				await ctx.reply(
					{
						embeds: [
							{
								description: '❌ There are not enough songs in the queue to shuffle!',
								color: 0xff3333,
							},
						],
					},
					{ ping: false },
				);
				return;
			}

			try {
				await queue.shuffle();
				await ctx.reply({
					embeds: [
						{
							description: '🔀 Shuffled the queue!',
							color: 0x5865f2,
						},
					],
				});
			} catch (error) {
				await ctx.reply(
					{
						embeds: [
							{
								description: `❌ Failed to shuffle: ${(error as Error).message}`,
								color: 0xff3333,
							},
						],
					},
					{ ping: false },
				);
			}
		})!,
});

export const queueCommand = defineCommand<DataObject, BotServices, {}>({
	name: 'queue',
	description: 'Displays or manages the music queue',
	aliases: ['q', 'list'],
	subcommands: [clearSubcommand, shuffleSubcommand],
	defaultSubcommand: 'view',
	pipeline: queuePipeline,
});
