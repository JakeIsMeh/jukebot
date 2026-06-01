import { VoiceBasedChannel } from 'discord.js';

import { defineMiddleware, DataObject } from './framework/index';

export const inVoice = defineMiddleware<{}, { voiceChannel: VoiceBasedChannel }, any>(
	async (ctx, next) => {
		const channel = ctx.member?.voice.channel;
		if (!channel) {
			await ctx.reply('❌ You must be in a voice channel!');
			return;
		}

		await next({
			...ctx,
			data: { ...ctx.data, voiceChannel: channel },
		});
	},
);

export const inSameVoice = defineMiddleware<{ voiceChannel: VoiceBasedChannel }, DataObject, any>(
	async (ctx, next) => {
		const userChannel = ctx.data.voiceChannel;
		const botVoiceChannelId = ctx.member?.guild.members.me?.voice.channelId;

		if (botVoiceChannelId && userChannel.id !== botVoiceChannelId) {
			await ctx.reply('❌ You must be in my voice channel!');
			return;
		}

		await next(ctx);
	},
);

export const performanceTimer = defineMiddleware<DataObject, DataObject, any>(async (ctx, next) => {
	const start = performance.now(); // 1. Logic "Before"

	await next(ctx); // 2. Downstream onion pipeline execution happens here

	const end = performance.now(); // 3. Logic "After"
	const duration = (end - start).toFixed(2);

	ctx.log.info(`⏱️ Execution took ${duration}ms`);
});
