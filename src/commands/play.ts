import { GuildTextBasedChannel } from 'discord.js';

import { Pipeline, defineCommand, InferSchemaTypes, DataObject } from '../framework/index';
import { inVoice, inSameVoice, performanceTimer } from '../middleware';
import { searchSong, isSpotifyTrack, isSpotifyPlaylistOrAlbum } from '../services/MusicPlayer';
import { BotServices } from '../types';

function isUrl(str: string): boolean {
	try {
		new URL(str);
		return true;
	} catch {
		return false;
	}
}

// 1. Declare the Option Schema
const options = {
	query: { type: 'string', description: 'Song name or URL', required: true },
} as const;

// 2. Build Pipeline carrying voice channel check and performance logging middlewares
const playPipeline = new Pipeline<{}, InferSchemaTypes<typeof options>, BotServices>()
	.use(performanceTimer)
	.use(inVoice)
	.use(inSameVoice)
	.run(async (ctx) => {
		const query = ctx.options.query;
		const channel = ctx.data.voiceChannel;

		ctx.log.info(`Streaming request`, { query, channel: channel.name });

		if (isSpotifyPlaylistOrAlbum(query)) {
			const resolveMsg = await ctx.reply({
				embeds: [
					{
						description: `🔍 Resolving Spotify playlist/album links...`,
						color: 0x5865f2,
					},
				],
			});
			try {
				await ctx.services.player.play(channel, query, {
					member: ctx.member ?? undefined,
					textChannel: (ctx.channel ?? undefined) as GuildTextBasedChannel | undefined,
					editMessage: resolveMsg,
				});
			} catch (error) {
				ctx.log.error('❌ Failed to play song', {}, error as Error);
				await resolveMsg
					.edit({
						embeds: [
							{
								description: `❌ Failed to play: ${(error as Error).message}`,
								color: 0xff3333,
							},
						],
					})
					.catch(() => {});
			}
			return;
		}

		if (isSpotifyTrack(query)) {
			const resolveMsg = await ctx.reply({
				embeds: [
					{
						description: `🔍 Resolving Spotify track link...`,
						color: 0x5865f2,
					},
				],
			});
			try {
				await ctx.services.player.play(channel, query, {
					member: ctx.member ?? undefined,
					textChannel: (ctx.channel ?? undefined) as GuildTextBasedChannel | undefined,
					editMessage: resolveMsg,
				});
			} catch (error) {
				ctx.log.error('❌ Failed to play song', {}, error as Error);
				await resolveMsg
					.edit({
						embeds: [
							{
								description: `❌ Failed to play song: ${(error as Error).message}`,
								color: 0xff3333,
							},
						],
					})
					.catch(() => {});
			}
			return;
		}

		if (isUrl(query)) {
			const resolveMsg = await ctx.reply({
				embeds: [
					{
						description: `🔍 Loading direct link...`,
						color: 0x5865f2,
					},
				],
			});
			try {
				await ctx.services.player.play(channel, query, {
					member: ctx.member ?? undefined,
					textChannel: (ctx.channel ?? undefined) as GuildTextBasedChannel | undefined,
					editMessage: resolveMsg,
				});
			} catch (error) {
				ctx.log.error('❌ Failed to play song', {}, error as Error);
				await resolveMsg
					.edit({
						embeds: [
							{
								description: `❌ Failed to play song: ${(error as Error).message}`,
								color: 0xff3333,
							},
						],
					})
					.catch(() => {});
			}
			return;
		}

		const resolveMsg = await ctx.reply({
			embeds: [
				{
					description: `🔍 Searching for \`${query}\`...`,
					color: 0x5865f2,
				},
			],
		});

		try {
			// Resolve song using high-fidelity YouTube Music search and Video filters
			const song = await searchSong(query);
			if (!song) {
				await resolveMsg
					.edit({
						embeds: [
							{
								description: `❌ No results found for your query!`,
								color: 0xff3333,
							},
						],
					})
					.catch(() => {});
				return;
			}

			ctx.log.info('🎯 Selected high-fidelity song', { name: song.name, url: song.url });

			// Play the selected best result
			await ctx.services.player.play(channel, song as any, {
				member: ctx.member ?? undefined,
				textChannel: (ctx.channel ?? undefined) as GuildTextBasedChannel | undefined,
				editMessage: resolveMsg,
			});
		} catch (error) {
			ctx.log.error('❌ Failed to play song', {}, error as Error);
			await resolveMsg
				.edit({
					embeds: [
						{
							description: `❌ Failed to play song: ${(error as Error).message}`,
							color: 0xff3333,
						},
					],
				})
				.catch(() => {});
		}
	});

// 3. Export Command configuration
export const playCommand = defineCommand<DataObject, BotServices, typeof options>({
	name: 'play',
	aliases: ['p', 'add'],
	description: 'Plays music from YouTube, YouTube Music, Spotify, or SoundCloud',
	options,
	pipeline: playPipeline,
});
