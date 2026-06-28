import { exec, spawn, ChildProcess } from 'child_process';
import util from 'util';

import {
	joinVoiceChannel,
	createAudioPlayer,
	createAudioResource,
	AudioPlayerStatus,
	VoiceConnectionStatus,
	StreamType,
	AudioPlayer,
	VoiceConnection,
} from '@discordjs/voice';
import { GuildTextBasedChannel, User, MessageFlags } from 'discord.js';
import { Innertube, YTNodes } from 'youtubei.js';

import { requestLogger } from '../framework/logger';

const execPromise = util.promisify(exec);

export interface Song {
	id: string;
	name: string;
	url: string;
	duration: number;
	formattedDuration: string;
	thumbnail?: string;
	user?: User;
	source?: string;
}

let ytInstance: Innertube | null = null;
async function getInnertube() {
	if (!ytInstance) {
		ytInstance = await Innertube.create();
	}
	return ytInstance;
}

function isUrl(str: string): boolean {
	try {
		new URL(str);
		return true;
	} catch {
		return false;
	}
}

function getAudioSourceFromUrl(streamUrl: string): string {
	const lower = streamUrl.toLowerCase();
	if (lower.includes('sndcdn.com') || lower.includes('soundcloud.com')) {
		return 'SoundCloud';
	}
	if (
		lower.includes('googlevideo.com') ||
		lower.includes('youtube.com') ||
		lower.includes('youtu.be')
	) {
		return 'YouTube';
	}
	if (lower.includes('bandcamp.com')) {
		return 'Bandcamp';
	}
	return 'Unknown';
}

function getOriginalSourceFromUrl(url: string): string {
	const lower = url.toLowerCase();
	if (lower.includes('spotify.com') || lower.startsWith('spotify:')) {
		return 'Spotify';
	}
	if (lower.includes('soundcloud.com')) {
		return 'SoundCloud';
	}
	if (lower.includes('bandcamp.com')) {
		return 'Bandcamp';
	}
	if (
		lower.includes('youtube.com') ||
		lower.includes('youtu.be') ||
		lower.includes('music.youtube.com')
	) {
		return 'YouTube';
	}
	return 'YouTube Search';
}

export function isSpotifyTrack(str: string): boolean {
	return str.includes('open.spotify.com/track/') || str.startsWith('spotify:track:');
}

function decodeHtmlEntities(str: string): string {
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&apos;/g, "'");
}

export async function resolveSpotifyTrack(url: string): Promise<string> {
	let trackUrl = url.split('?')[0];
	if (trackUrl.startsWith('spotify:track:')) {
		const id = trackUrl.split(':').pop();
		trackUrl = `https://open.spotify.com/track/${id}`;
	}

	try {
		const res = await fetch(trackUrl, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
			},
		});
		if (res.status === 200) {
			const html = await res.text();
			const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
			const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);

			const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : null;
			const desc = descMatch ? decodeHtmlEntities(descMatch[1]) : null;

			if (title && desc) {
				const parts = desc.split('·').map((p) => p.trim());
				const artist = parts[0];
				return `${artist} - ${title}`;
			} else if (title) {
				return title;
			}
		}
	} catch (e) {
		requestLogger.warn('Spotify HTML resolve failed, trying oEmbed backup', { error: String(e) });
	}

	// Backup: oEmbed API
	try {
		const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`;
		const res = await fetch(oembedUrl);
		if (res.status === 200) {
			const json = (await res.json()) as any;
			if (json.title) {
				return json.title;
			}
		}
	} catch (e) {
		requestLogger.error('Spotify oEmbed backup failed', {}, e as Error);
	}

	throw new Error(
		'Could not resolve Spotify track metadata. Please verify the link is public and active.',
	);
}

export function isSpotifyPlaylistOrAlbum(str: string): boolean {
	return (
		str.includes('open.spotify.com/playlist/') ||
		str.includes('open.spotify.com/album/') ||
		str.startsWith('spotify:playlist:') ||
		str.startsWith('spotify:album:')
	);
}

export async function resolveSpotifyPlaylistOrAlbum(url: string): Promise<string[]> {
	let id = '';
	let type = ''; // 'playlist' or 'album'

	const cleanUrl = url.split('?')[0].trim();
	if (cleanUrl.startsWith('spotify:playlist:')) {
		id = cleanUrl.split(':').pop() || '';
		type = 'playlist';
	} else if (cleanUrl.startsWith('spotify:album:')) {
		id = cleanUrl.split(':').pop() || '';
		type = 'album';
	} else {
		const match = cleanUrl.match(/open\.spotify\.com\/(playlist|album)\/([a-zA-Z0-9]+)/);
		if (match) {
			type = match[1];
			id = match[2];
		}
	}

	if (id && type) {
		const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
		try {
			const res = await fetch(embedUrl, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
				},
			});
			if (res.status === 200) {
				const html = await res.text();
				const match = html.match(
					/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
				);
				if (match) {
					const data = JSON.parse(match[1].trim());
					const entity = data?.props?.pageProps?.state?.data?.entity;
					const tracks = entity?.trackList;
					if (Array.isArray(tracks) && tracks.length > 0) {
						const queries: string[] = [];
						for (const track of tracks) {
							const title = track?.title;
							const artist = track?.subtitle || '';
							if (title) {
								const query = artist ? `${artist} - ${title}` : title;
								const cleanQuery = query.replace(/\s+/g, ' ').trim();
								queries.push(cleanQuery);
							}
						}
						if (queries.length > 0) {
							return queries;
						}
					}
				}
			}
		} catch (e) {
			requestLogger.warn('Spotify embed resolve failed, falling back to page scraper', {
				error: String(e),
			});
		}
	}

	// Fallback to original scraper logic
	let targetUrl = cleanUrl;
	if (targetUrl.startsWith('spotify:playlist:')) {
		targetUrl = `https://open.spotify.com/playlist/${id}`;
	} else if (targetUrl.startsWith('spotify:album:')) {
		targetUrl = `https://open.spotify.com/album/${id}`;
	}

	const res = await fetch(targetUrl, {
		headers: {
			'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
		},
	});

	if (res.status !== 200) {
		throw new Error(`Failed to fetch Spotify page. Status: ${res.status}`);
	}

	const html = await res.text();
	const matches = html.matchAll(
		/<meta (?:name|property)="music:song" content="(https:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+)"/g,
	);
	const trackUrls: string[] = [];
	for (const match of matches) {
		if (!trackUrls.includes(match[1])) {
			trackUrls.push(match[1]);
		}
	}

	if (trackUrls.length === 0) {
		throw new Error('No tracks found in the provided Spotify playlist/album.');
	}

	const resolvedQueries = await Promise.all(
		trackUrls.map(async (trackUrl) => {
			try {
				return await resolveSpotifyTrack(trackUrl);
			} catch (err) {
				requestLogger.warn(`Failed to resolve track ${trackUrl}`, { error: String(err) });
				return null;
			}
		}),
	);

	const cleanQueries = resolvedQueries.filter((q): q is string => q !== null);
	if (cleanQueries.length === 0) {
		throw new Error('Failed to resolve any tracks from the Spotify playlist/album.');
	}

	return cleanQueries;
}

function formatDuration(sec: number): string {
	if (!sec) return '0:00';
	const totalSeconds = Math.round(sec);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

async function getStreamUrl(
	url: string,
	songName?: string,
): Promise<{ url: string; source: string }> {
	try {
		const { stdout } = await execPromise(`yt-dlp -g -f bestaudio "${url}"`);
		return { url: stdout.trim(), source: getAudioSourceFromUrl(url) };
	} catch (e: any) {
		const errMsg = (e?.stderr || e?.message || '').toLowerCase();
		const isAgeRestricted =
			errMsg.includes('confirm your age') ||
			errMsg.includes('sign in') ||
			errMsg.includes('restricted');

		if (songName) {
			if (isAgeRestricted) {
				requestLogger.warn(
					`[Stream Fallback] Original URL is age-restricted. Attempting fallbacks for "${songName}"...`,
				);
			} else {
				requestLogger.warn(
					`[Stream Fallback] Failed to stream URL directly. Attempting fallbacks for "${songName}"...`,
				);
			}

			// 1. Try SoundCloud Search
			try {
				const { stdout } = await execPromise(`yt-dlp -g -f bestaudio "scsearch:${songName}"`);
				if (stdout.trim()) {
					requestLogger.info(
						`[Stream Fallback] Successfully resolved SoundCloud stream for "${songName}"`,
					);
					return { url: stdout.trim(), source: 'SoundCloud' };
				}
			} catch (scErr) {
				requestLogger.warn(`[Stream Fallback] SoundCloud fallback failed for "${songName}"`, {
					error: String(scErr),
				});
			}

			// 2. Try Bandcamp Search
			try {
				const { stdout } = await execPromise(`yt-dlp -g -f bestaudio "bcsearch:${songName}"`);
				if (stdout.trim()) {
					requestLogger.info(
						`[Stream Fallback] Successfully resolved Bandcamp stream for "${songName}"`,
					);
					return { url: stdout.trim(), source: 'Bandcamp' };
				}
			} catch (bcErr) {
				requestLogger.warn(`[Stream Fallback] Bandcamp fallback failed for "${songName}"`, {
					error: String(bcErr),
				});
			}

			// 3. Try YouTube Search (find another upload of the same song)
			try {
				const { stdout } = await execPromise(`yt-dlp -g -f bestaudio "ytsearch:${songName}"`);
				if (stdout.trim()) {
					requestLogger.info(
						`[Stream Fallback] Successfully resolved YouTube search fallback for "${songName}"`,
					);
					return { url: stdout.trim(), source: 'YouTube' };
				}
			} catch (ytErr) {
				requestLogger.warn(`[Stream Fallback] YouTube search fallback failed for "${songName}"`, {
					error: String(ytErr),
				});
			}
		}

		throw e;
	}
}

async function getMetadata(url: string): Promise<any[]> {
	const { stdout } = await execPromise(`yt-dlp --dump-json --skip-download "${url}"`);
	const lines = stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.map((line) => JSON.parse(line));
}

export async function searchSong(query: string): Promise<Omit<Song, 'user'> | null> {
	const yt = await getInnertube();
	try {
		const musicSearch = await yt.music.search(query, { type: 'song' });
		const song = musicSearch.songs?.contents?.[0];
		if (song) {
			return {
				id: song.id!,
				name: song.title!,
				url: `https://www.youtube.com/watch?v=${song.id}`,
				duration: song.duration?.seconds || 0,
				formattedDuration: song.duration?.text || '0:00',
				thumbnail: song.thumbnails?.[0]?.url,
			};
		}
	} catch (e) {
		requestLogger.warn('YouTube Music search failed, falling back to standard search', {
			error: String(e),
		});
	}

	try {
		const search = await yt.search(query, { type: 'video' });
		const videos = search.videos.filterType(YTNodes.Video);
		const video = videos[0];
		if (video) {
			return {
				id: video.video_id,
				name: video.title.text || video.title.toString(),
				url: `https://www.youtube.com/watch?v=${video.video_id}`,
				duration: video.duration?.seconds || 0,
				formattedDuration: video.duration?.text || '0:00',
				thumbnail: video.best_thumbnail?.url || video.thumbnails?.[0]?.url,
			};
		}
	} catch (e) {
		requestLogger.error('Standard search failed', {}, e as Error);
	}

	return null;
}

export const queueTimerManager = {
	timers: new Map<string, NodeJS.Timeout>(),
	getTimeout(_guildId: string): number {
		return Number(process.env.EMPTY_QUEUE_TIMEOUT_MS) || 180000;
	},
	start(guildId: string, textChannel: any, playerInstance: any) {
		this.clear(guildId);
		const durationMs = this.getTimeout(guildId);

		const timer = setTimeout(() => {
			try {
				if (textChannel) {
					textChannel
						.send({
							embeds: [
								{
									title: '💤 Leaving Voice Channel',
									description: `I've disconnected from the voice channel because the queue has been empty for **${(durationMs / 60000).toFixed(0)} minutes**. Play some more music to invite me back!`,
									color: 0x5865f2,
								},
							],
							flags: [MessageFlags.SuppressNotifications],
						})
						.catch((err: any) =>
							requestLogger.error('❌ Failed to send idle leave message', {}, err as Error),
						);
				}
				playerInstance.leave();
				this.timers.delete(guildId);
			} catch (err) {
				requestLogger.error('❌ Failed to leave voice channel on idle timeout', {}, err as Error);
			}
		}, durationMs);

		this.timers.set(guildId, timer);
		requestLogger.info(`⏱️ Started empty queue timer for guild ${guildId} (${durationMs}ms)`);
	},
	clear(guildId: string) {
		const timer = this.timers.get(guildId);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(guildId);
			requestLogger.info(`⏱️ Cleared empty queue timer for guild ${guildId}`);
		}
	},
};

export class GuildPlayer {
	guildId: string;
	voiceConnection: VoiceConnection | null = null;
	audioPlayer: AudioPlayer | null = null;
	ffmpegProcess: ChildProcess | null = null;
	queue: Song[] = [];
	history: Song[] = [];
	volume = 65;
	textChannel: GuildTextBasedChannel | null = null;
	isPlaying = false;
	isPaused = false;
	autoplay = false;
	repeatMode = 0;
	currentResource: any = null;
	currentAudioSource: string | null = null;
	playbackStartTime = 0;
	pausedDuration = 0;
	pauseTime = 0;
	/**
	 * Guard flag: set to `true` while a new song is being prepared for playback.
	 * Prevents `onSongFinished()` from triggering the idle timer during the
	 * async gap between stream resolution and AudioPlayer.play().
	 */
	private _preparingPlay = false;

	constructor(guildId: string) {
		this.guildId = guildId;
	}

	get songs() {
		return this.queue;
	}

	get playing() {
		return this.isPlaying && !this.isPaused;
	}

	get paused() {
		return this.isPaused;
	}

	get currentTime() {
		if (!this.isPlaying) return 0;
		let elapsed = (Date.now() - this.playbackStartTime - this.pausedDuration) / 1000;
		if (this.isPaused) {
			elapsed = (this.pauseTime - this.playbackStartTime - this.pausedDuration) / 1000;
		}
		return Math.max(0, Math.floor(elapsed));
	}

	get formattedCurrentTime() {
		const sec = this.currentTime;
		const minutes = Math.floor(sec / 60);
		const seconds = sec % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	cleanupProcess() {
		if (this.ffmpegProcess) {
			try {
				this.ffmpegProcess.kill();
			} catch {
				// Ignore
			}
			this.ffmpegProcess = null;
		}
	}

	/** Bound handler so we can remove it to prevent listener leaks across re-joins. */
	private _onDisconnected = () => {
		void this.stop();
	};

	join(voiceChannel: any) {
		// Remove the previous Disconnected listener (if any) to avoid duplicates.
		if (this.voiceConnection) {
			this.voiceConnection.off(VoiceConnectionStatus.Disconnected, this._onDisconnected);
		}

		this.voiceConnection = joinVoiceChannel({
			channelId: voiceChannel.id,
			guildId: this.guildId,
			adapterCreator: voiceChannel.guild.voiceAdapterCreator,
			selfDeaf: true,
			selfMute: false,
		});

		this.voiceConnection.on(VoiceConnectionStatus.Disconnected, this._onDisconnected);

		if (!this.audioPlayer) {
			this.audioPlayer = createAudioPlayer();
			this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
				this.onSongFinished();
			});
			this.audioPlayer.on('error', (error) => {
				requestLogger.error('Audio player error', {}, error as Error);
				this.onSongFinished();
			});
			this.voiceConnection.subscribe(this.audioPlayer);
		}
	}

	async play(song: Song) {
		if (!this.audioPlayer || !this.voiceConnection) {
			throw new Error('Not connected to a voice channel.');
		}

		this.cleanupProcess();
		this._preparingPlay = true;

		try {
			const stream = await getStreamUrl(song.url, song.name);
			this.currentAudioSource = stream.source;

			const ffmpegProcess = spawn(
				'ffmpeg',
				[
					'-reconnect',
					'1',
					'-reconnect_streamed',
					'1',
					'-reconnect_delay_max',
					'5',
					'-i',
					stream.url,
					'-analyzeduration',
					'0',
					'-loglevel',
					'0',
					'-af',
					'loudnorm=I=-16:TP=-1.5:LRA=11',
					'-f',
					's16le',
					'-ar',
					'48000',
					'-ac',
					'2',
					'pipe:1',
				],
				{
					stdio: ['ignore', 'pipe', 'ignore'],
				},
			);

			this.ffmpegProcess = ffmpegProcess;

			const resource = createAudioResource(ffmpegProcess.stdout!, {
				inputType: StreamType.Raw,
				inlineVolume: true,
			});

			resource.volume?.setVolumeLogarithmic(this.volume / 100);
			this.currentResource = resource;
			this.playbackStartTime = Date.now();
			this.pausedDuration = 0;
			this.isPaused = false;
			this.isPlaying = true;

			this.audioPlayer.play(resource);
			this._preparingPlay = false;
		} catch (err) {
			this._preparingPlay = false;
			requestLogger.error('Error starting playback', {}, err as Error);
			if (this.textChannel) {
				this.textChannel
					.send({
						embeds: [
							{
								description: `⚠️ Error playing song: ${(err as Error).message}`,
								color: 0xff3333,
							},
						],
					})
					.catch(() => {});
			}
			this.onSongFinished();
		}
	}

	onSongFinished() {
		if (!this.isPlaying) return;
		this.isPlaying = false;
		this.currentResource = null;
		this.cleanupProcess();
		const finishedSong = this.queue.shift();
		if (finishedSong) {
			this.history.push(finishedSong);
			if (this.history.length > 100) {
				this.history.shift();
			}
		}

		if (this.queue.length > 0) {
			const nextSong = this.queue[0];
			if (this.textChannel) {
				this.textChannel
					.send({
						embeds: [
							{
								title: `Now Playing 🎶`,
								description: `**[${nextSong.name}](${nextSong.url})**\nDuration: \`${nextSong.formattedDuration}\`\nSource: \`${nextSong.source || 'Unknown'}\`\nRequested by: ${nextSong.user?.username ?? 'Unknown'}`,
								thumbnail: nextSong.thumbnail ? { url: nextSong.thumbnail } : undefined,
								color: 0x5865f2,
							},
						],
						flags: [MessageFlags.SuppressNotifications],
					})
					.catch(() => {});
			}
			void this.play(nextSong);
		} else if (!this._preparingPlay) {
			// Only start the idle timer if we are NOT in the middle of setting up a
			// new song.  Without this guard, the AudioPlayer Idle event that fires
			// when the previous resource's stream pipeline tears down during a
			// skip-then-play would race with the new play() call and incorrectly
			// start the empty-queue timer.
			if (this.textChannel) {
				this.textChannel
					.send({
						embeds: [
							{
								description: '🏁 The queue has finished playing all songs. Entering idle state...',
								color: 0x5865f2,
							},
						],
						flags: [MessageFlags.SuppressNotifications],
					})
					.catch(() => {});
				queueTimerManager.start(this.guildId, this.textChannel, this);
			}
		}
	}

	async pause(): Promise<boolean> {
		if (this.audioPlayer && this.isPlaying && !this.isPaused) {
			this.audioPlayer.pause();
			this.isPaused = true;
			this.pauseTime = Date.now();
			return true;
		}
		return false;
	}

	async resume(): Promise<boolean> {
		if (this.audioPlayer && this.isPaused) {
			this.audioPlayer.unpause();
			this.isPaused = false;
			this.pausedDuration += Date.now() - this.pauseTime;
			return true;
		}
		return false;
	}

	async skip(): Promise<Song> {
		if (!this.audioPlayer || !this.isPlaying) {
			throw new Error('Nothing is playing.');
		}
		const nextSong = this.queue[1];
		if (!nextSong) {
			throw new Error('No song to skip to.');
		}
		this.audioPlayer.stop();
		return nextSong;
	}

	async jump(relativeIndex: number): Promise<Song> {
		if (relativeIndex === 0 && this.isPlaying) {
			throw new Error('Cannot jump to the currently playing song.');
		}

		if (!this.audioPlayer || !this.voiceConnection) {
			throw new Error('Not connected to a voice channel.');
		}

		// Clear idle timers since we are going to start playing
		queueTimerManager.clear(this.guildId);

		if (relativeIndex < 0) {
			// Jump backward into history
			const historyIdx = this.history.length + relativeIndex;
			if (historyIdx < 0 || historyIdx >= this.history.length) {
				throw new Error('Invalid history index.');
			}

			const targetSong = this.history[historyIdx];

			// Stop the current song safely (onSongFinished will return early)
			this.isPlaying = false;
			this.audioPlayer.stop();

			// Move the target song and any songs played after it back into the queue
			const movedSongs = this.history.splice(historyIdx);
			this.queue = [...movedSongs, ...this.queue];

			// Play the target song
			await this.play(this.queue[0]);
			return targetSong;
		} else {
			// Jump forward into upcoming queue
			if (relativeIndex >= this.queue.length) {
				throw new Error('Invalid queue index.');
			}

			const targetSong = this.queue[relativeIndex];

			// Stop the current song safely
			this.isPlaying = false;
			this.audioPlayer.stop();

			// Move skipped songs (including current song) to history
			const skipped = this.queue.splice(0, relativeIndex);
			this.history.push(...skipped);
			if (this.history.length > 100) {
				this.history.splice(0, this.history.length - 100);
			}

			// Play the target song
			await this.play(this.queue[0]);
			return targetSong;
		}
	}

	async stop(): Promise<void> {
		this.isPlaying = false;
		this.queue = [];
		this.history = [];
		// Kill the ffmpeg process before the AudioPlayer tears down the resource.
		// audioPlayer.stop(true) internally destroys the resource's playStream
		// pipeline (including ffmpegStdout).  On Windows, destroying the pipe
		// while the child process is still writing can leave stale handles.
		this.cleanupProcess();
		if (this.audioPlayer) {
			this.audioPlayer.stop(true);
		}
		this.isPaused = false;
		this.currentResource = null;
	}

	setVolume(volume: number) {
		this.volume = Math.max(0, Math.min(200, volume));
		if (this.currentResource?.volume) {
			this.currentResource.volume.setVolumeLogarithmic(this.volume / 100);
		}
	}

	async shuffle(): Promise<void> {
		if (this.queue.length <= 2) return;
		const current = this.queue[0];
		const upcoming = this.queue.slice(1);
		for (let i = upcoming.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const temp = upcoming[i];
			upcoming[i] = upcoming[j];
			upcoming[j] = temp;
		}
		this.queue = [current, ...upcoming];
	}

	leave() {
		void this.stop();
		if (this.voiceConnection) {
			this.voiceConnection.destroy();
			this.voiceConnection = null;
		}
		this.audioPlayer = null;
		this.history = [];
	}
}

export class MusicPlayerManager {
	players = new Map<string, GuildPlayer>();

	getQueue(guildId: string): GuildPlayer | undefined {
		return this.players.get(guildId);
	}

	getOrCreatePlayer(guildId: string): GuildPlayer {
		let player = this.players.get(guildId);
		if (!player) {
			player = new GuildPlayer(guildId);
			this.players.set(guildId, player);
		}
		return player;
	}

	async play(
		voiceChannel: any,
		queryOrSong: string | Song,
		options: { member?: any; textChannel?: any; editMessage?: any } = {},
	) {
		const guildId = voiceChannel.guild.id;
		const player = this.getOrCreatePlayer(guildId);

		queueTimerManager.clear(guildId);

		player.join(voiceChannel);
		if (options.textChannel) {
			player.textChannel = options.textChannel;
		}

		let song: Song;
		if (typeof queryOrSong === 'string') {
			if (isSpotifyPlaylistOrAlbum(queryOrSong)) {
				const searchQueries = await resolveSpotifyPlaylistOrAlbum(queryOrSong);
				const searchResults = await Promise.all(
					searchQueries.map(async (q) => {
						try {
							return await searchSong(q);
						} catch {
							return null;
						}
					}),
				);

				const resolvedSongs = searchResults.filter((s): s is NonNullable<typeof s> => s !== null);
				if (resolvedSongs.length === 0) {
					throw new Error(
						'No YouTube Music matches found for any tracks in the Spotify playlist/album.',
					);
				}

				const songsToQueue: Song[] = resolvedSongs.map((resolved) => ({
					...resolved,
					user: options.member?.user,
					source: 'Spotify',
				}));

				const isFirst = player.queue.length === 0;
				player.queue.push(...songsToQueue);

				if (options.editMessage) {
					await options.editMessage
						.edit({
							content: null,
							embeds: [
								{
									title: `Queued Spotify Playlist 📂`,
									description: `Added **${songsToQueue.length} tracks** from the Spotify playlist/album to the queue.\nRequested by: ${options.member?.user?.username ?? 'Unknown'}`,
									color: 0x1db954,
								},
							],
						})
						.catch(() => {});
				} else if (options.textChannel) {
					options.textChannel
						.send({
							embeds: [
								{
									title: `Queued Spotify Playlist 📂`,
									description: `Added **${songsToQueue.length} tracks** from the Spotify playlist/album to the queue.\nRequested by: ${options.member?.user?.username ?? 'Unknown'}`,
									color: 0x1db954,
								},
							],
						})
						.catch(() => {});
				}

				if (isFirst) {
					await player.play(songsToQueue[0]);
				}
				return;
			} else if (isSpotifyTrack(queryOrSong)) {
				const searchQuery = await resolveSpotifyTrack(queryOrSong);
				const resolved = await searchSong(searchQuery);
				if (!resolved) {
					throw new Error(`No YouTube Music match found for: "${searchQuery}"`);
				}
				song = {
					...resolved,
					user: options.member?.user,
					source: 'Spotify',
				};
			} else if (isUrl(queryOrSong)) {
				const metaList = await getMetadata(queryOrSong);
				if (metaList.length === 0) {
					throw new Error('No tracks found in the provided URL.');
				}

				const songsToQueue: Song[] = metaList.map((meta) => ({
					id: String(meta.id || ''),
					name: meta.title || 'Unknown',
					url: meta.webpage_url || queryOrSong,
					duration: meta.duration || 0,
					formattedDuration: formatDuration(meta.duration || 0),
					thumbnail: meta.thumbnail,
					user: options.member?.user,
					source: getOriginalSourceFromUrl(meta.webpage_url || queryOrSong),
				}));

				const isFirst = player.queue.length === 0;
				player.queue.push(...songsToQueue);

				if (songsToQueue.length === 1) {
					const singleSong = songsToQueue[0];
					if (isFirst) {
						// Resolve stream first so currentAudioSource reflects any fallbacks
						await player.play(singleSong);

						const resolvedSource = player.currentAudioSource || singleSong.source || 'Unknown';
						let sourceText = singleSong.source || 'Unknown';
						if (resolvedSource !== singleSong.source && singleSong.source !== 'YouTube Search') {
							sourceText += ` (Audio: ${resolvedSource})`;
						} else if (singleSong.source === 'YouTube Search' && resolvedSource) {
							sourceText = `YouTube Search (Audio: ${resolvedSource})`;
						}

						const nowPlayingEmbed = {
							title: `Now Playing 🎶`,
							description: `**[${singleSong.name}](${singleSong.url})**\nDuration: \`${singleSong.formattedDuration}\`\nSource: \`${sourceText}\`\nRequested by: ${singleSong.user?.username ?? 'Unknown'}`,
							thumbnail: singleSong.thumbnail ? { url: singleSong.thumbnail } : undefined,
							color: 0x5865f2,
						};

						if (options.editMessage) {
							await options.editMessage
								.edit({ content: null, embeds: [nowPlayingEmbed] })
								.catch(() => {});
						} else if (options.textChannel) {
							options.textChannel.send({ embeds: [nowPlayingEmbed] }).catch(() => {});
						}
					} else {
						if (options.editMessage) {
							await options.editMessage
								.edit({
									content: null,
									embeds: [
										{
											title: `Added to Queue 📝`,
											description: `**[${singleSong.name}](${singleSong.url})** has been added.\nDuration: \`${singleSong.formattedDuration}\`\nRequested by: ${singleSong.user?.username ?? 'Unknown'}`,
											thumbnail: singleSong.thumbnail ? { url: singleSong.thumbnail } : undefined,
											color: 0x5865f2,
										},
									],
								})
								.catch(() => {});
						} else if (options.textChannel) {
							options.textChannel
								.send({
									embeds: [
										{
											title: `Added to Queue 📝`,
											description: `**[${singleSong.name}](${singleSong.url})** has been added.\nDuration: \`${singleSong.formattedDuration}\`\nRequested by: ${singleSong.user?.username ?? 'Unknown'}`,
											thumbnail: singleSong.thumbnail ? { url: singleSong.thumbnail } : undefined,
											color: 0x5865f2,
										},
									],
								})
								.catch(() => {});
						}
					}
				} else {
					if (options.editMessage) {
						await options.editMessage
							.edit({
								content: null,
								embeds: [
									{
										title: `Queued Playlist 📂`,
										description: `Added **${songsToQueue.length} tracks** from the playlist/album to the queue.\nRequested by: ${options.member?.user?.username ?? 'Unknown'}`,
										color: 0x5865f2,
									},
								],
							})
							.catch(() => {});
					} else if (options.textChannel) {
						options.textChannel
							.send({
								embeds: [
									{
										title: `Queued Playlist 📂`,
										description: `Added **${songsToQueue.length} tracks** from the playlist/album to the queue.\nRequested by: ${options.member?.user?.username ?? 'Unknown'}`,
										color: 0x5865f2,
									},
								],
							})
							.catch(() => {});
					}
					if (isFirst) {
						await player.play(songsToQueue[0]);
					}
				}
				return;
			} else {
				const resolved = await searchSong(queryOrSong);
				if (!resolved) {
					throw new Error('No search results found.');
				}
				song = {
					...resolved,
					user: options.member?.user,
					source: 'YouTube Search',
				};
			}
		} else {
			song = {
				...queryOrSong,
				user: options.member?.user,
				source: queryOrSong.source || getOriginalSourceFromUrl(queryOrSong.url),
			};
		}

		const isFirst = player.queue.length === 0;
		player.queue.push(song);

		if (isFirst) {
			// Resolve the stream first so currentAudioSource reflects any fallbacks
			// (e.g. age-restricted YouTube → SoundCloud) before we show the embed.
			await player.play(song);

			const resolvedSource = player.currentAudioSource || song.source || 'Unknown';
			let sourceText = song.source || 'Unknown';
			if (resolvedSource !== song.source && song.source !== 'YouTube Search') {
				sourceText += ` (Audio: ${resolvedSource})`;
			} else if (song.source === 'YouTube Search' && resolvedSource) {
				sourceText = `YouTube Search (Audio: ${resolvedSource})`;
			}

			const nowPlayingEmbed = {
				title: `Now Playing 🎶`,
				description: `**[${song.name}](${song.url})**\nDuration: \`${song.formattedDuration}\`\nSource: \`${sourceText}\`\nRequested by: ${song.user?.username ?? 'Unknown'}`,
				thumbnail: song.thumbnail ? { url: song.thumbnail } : undefined,
				color: 0x5865f2,
			};

			if (options.editMessage) {
				await options.editMessage
					.edit({
						content: null,
						embeds: [nowPlayingEmbed],
					})
					.catch(() => {});
			} else if (options.textChannel) {
				options.textChannel.send({ embeds: [nowPlayingEmbed] }).catch(() => {});
			}
		} else {
			if (options.editMessage) {
				await options.editMessage
					.edit({
						content: null,
						embeds: [
							{
								title: `Added to Queue 📝`,
								description: `**[${song.name}](${song.url})** has been added.\nDuration: \`${song.formattedDuration}\`\nRequested by: ${song.user?.username ?? 'Unknown'}`,
								thumbnail: song.thumbnail ? { url: song.thumbnail } : undefined,
								color: 0x5865f2,
							},
						],
					})
					.catch(() => {});
			} else if (options.textChannel) {
				options.textChannel
					.send({
						embeds: [
							{
								title: `Added to Queue 📝`,
								description: `**[${song.name}](${song.url})** has been added.\nDuration: \`${song.formattedDuration}\`\nRequested by: ${song.user?.username ?? 'Unknown'}`,
								thumbnail: song.thumbnail ? { url: song.thumbnail } : undefined,
								color: 0x5865f2,
							},
						],
					})
					.catch(() => {});
			}
		}

		// Final safety net: if onSongFinished() raced during the play/embed update
		// and re-started the idle timer, clear it now. The player is actively playing.
		if (player.isPlaying) {
			queueTimerManager.clear(guildId);
		}
	}

	voices = {
		join: async (voiceChannel: any) => {
			const player = this.getOrCreatePlayer(voiceChannel.guild.id);
			player.join(voiceChannel);
		},
		leave: (guildId: string) => {
			const player = this.players.get(guildId);
			if (player) {
				player.leave();
				this.players.delete(guildId);
			}
		},
	};
}
