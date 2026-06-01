import { defineConfig } from 'tsdown';

export default defineConfig((options) => {
	const isWatchMode = !!options.watch;

	return {
		entry: './src/main.ts',
		format: 'esm',
		plugins: [],
		...(!isWatchMode && {
			exe: { fileName: 'bot' },
		}),
	};
});
