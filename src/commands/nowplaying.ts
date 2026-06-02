import { Pipeline, defineCommand, DataObject } from '../framework/index';
import { performanceTimer } from '../middleware';
import { BotServices } from '../types';

const nowplayingPipeline = new Pipeline<{}, Record<string, never>, BotServices>().run(
	async (ctx) => {
		const queue = ctx.services.player.getQueue(ctx.member!.guild.id);
		if (!queue || !queue.playing) {
			await ctx.reply('❌ There is nothing playing right now!', { ping: false });
			return;
		}

		const song = queue.songs[0];
		const currentProgress = queue.currentTime;
		const totalDuration = song.duration;
		const formattedProgress = queue.formattedCurrentTime;

		// Create a simple visual progress bar
		const barSize = 20;
		const progress =
			totalDuration > 0 ? Math.round((currentProgress / totalDuration) * barSize) : 0;
		const emptyProgress = barSize - progress;
		const progressBar = '▬'.repeat(progress) + '🔘' + '▬'.repeat(emptyProgress);

		let sourceText = song.source || 'Unknown';
		if (
			queue.currentAudioSource &&
			queue.currentAudioSource !== song.source &&
			song.source !== 'YouTube Search'
		) {
			sourceText += ` (Audio: ${queue.currentAudioSource})`;
		} else if (queue.currentAudioSource && song.source === 'YouTube Search') {
			sourceText = `YouTube Search (Audio: ${queue.currentAudioSource})`;
		}

		await ctx.reply({
			embeds: [
				{
					title: `Now Playing 🎶`,
					description: `**[${song.name}](${song.url})**\n\n\`${formattedProgress}\` ${progressBar} \`${song.formattedDuration}\`\n\n**Source:** ${sourceText}\n**Requested By:** ${song.user?.username ?? 'Unknown'}`,
					thumbnail: song.thumbnail ? { url: song.thumbnail } : undefined,
					color: 0x5865f2,
					footer: {
						text: `Volume: ${queue.volume}% | Loop: ${queue.repeatMode === 0 ? 'Off' : queue.repeatMode === 1 ? 'Song' : 'Queue'}`,
					},
				},
			],
		});
	},
);

export const nowplayingCommand = defineCommand<DataObject, BotServices, {}>({
	name: 'nowplaying',
	description: 'Displays the currently playing song',
	aliases: ['np', 'current'],
	pipeline: nowplayingPipeline,
});
