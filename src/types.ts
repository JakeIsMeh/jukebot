import { MusicPlayerManager } from './services/MusicPlayer';

export interface BotServices extends Record<string, any> {
	player: MusicPlayerManager;
	queueTimers: {
		start(guildId: string, textChannel: any, player: any): void;
		clear(guildId: string): void;
	};
}
