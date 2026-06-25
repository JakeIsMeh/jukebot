import { MusicPlayerManager, queueTimerManager } from './services/MusicPlayer';

export interface BotServices extends Record<string, any> {
	player: MusicPlayerManager;
	queueTimers: typeof queueTimerManager;
}
