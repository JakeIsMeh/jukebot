# Developer Guide: Slash Command Autocomplete

Autocomplete allows slash commands to provide dynamic, real-time suggestion lists as the user types arguments inside the Discord UI.

This guide details how to implement, register, and write type-safe autocomplete handlers using our declarative options schema.

---

## 1. How It Works

Autocomplete in our framework is built directly into the **Declarative Option Schema**.

To enable autocomplete on an option (supported for `'string'`, `'integer'`, and `'number'` types), simply attach an `autocomplete` callback directly onto the option's metadata:

```typescript
export interface CommandOption {
	type: OptionType;
	description: string;
	required?: boolean;
	autocomplete?: AutocompleteCallback<TServices>;
}
```

When you synchronize commands with Discord using `syncCommands()`, the framework automatically detects the presence of the `autocomplete` callback and sets `.setAutocomplete(true)` on the corresponding Discord Option Builders natively.

---

## 2. Step-by-Step Implementation Example

Here is a real-world example of a `play` command that autocompletes track queries dynamically using an injected `MusicPlayer` service:

```typescript
// src/commands/play.ts
import { Pipeline, defineCommand, InferSchemaTypes } from '../framework/index';
import { MusicPlayer } from '../player';

// 1. Declare the Service contract required by this file
interface PlayServices {
	player: MusicPlayer;
}

// 2. Define Options Schema with an Autocomplete handler
const options = {
	query: {
		type: 'string',
		description: 'The track name or URL to play',
		required: true,
		// Autocomplete Callback!
		autocomplete: async (ctx, focusedValue) => {
			const query = String(focusedValue).trim();
			if (!query) {
				return [{ name: '🎸 Enter a song title to search...', value: '' }];
			}

			// Access your injected services with 100% type safety!
			const player = ctx.services.player;
			const searchResults = await player.search(query);

			// Return up to 25 choices (Discord API maximum limit)
			return searchResults.slice(0, 25).map((track) => ({
				name: `${track.title} [${track.duration}]`,
				value: track.url,
			}));
		},
	},
} as const;

// 3. Build your standard execution pipeline
const playPipeline = new Pipeline<{}, InferSchemaTypes<typeof options>, PlayServices>().run(
	async (ctx) => {
		const trackUrl = ctx.options.query;
		const player = ctx.services.player;

		await player.play(ctx.member?.voice.channel, trackUrl);
		await ctx.reply(`🎸 Now playing track!`);
	},
);

export const playCommand = defineCommand({
	name: 'play',
	description: 'Plays music from YouTube or Spotify',
	options,
	pipeline: playPipeline,
});
```

---

## 3. Typings and Autocomplete Context

During the autocomplete phase, the user is still in the middle of typing their parameters in the Discord UI. Consequently, **options have not yet been submitted or validated**.

To reflect this safely in our type system, the `ctx` object passed to the `autocomplete` callback **omits the `options` property**:

```typescript
export type AutocompleteCallback<TServices> = (
	ctx: Omit<Context<any, any, TServices>, 'options'>,
	focusedValue: string | number,
) =>
	| Promise<{ name: string; value: string | number }[]>
	| { name: string; value: string | number }[];
```

This prevents runtime errors by making it a compile-time compile error to attempt to access `ctx.options` inside autocomplete logic.

---

## 4. Best Practices for Autocomplete Authors

1. **Observe the 3-Second Rule:** Discord strictly requires autocomplete handlers to respond within **3 seconds**. Keep your autocomplete logic fast. If you are querying external APIs, implement local caching or bounce searches.
2. **Handle Empty Queries Gracefully:** When a user clicks the command box but hasn't typed anything yet, `focusedValue` will be an empty string `""`. Always provide a clean default instruction list (e.g. `[{ name: 'Type a song title...', value: '' }]`) instead of throwing an error.
3. **Caps limit to 25 choices:** The Discord API will reject autocomplete responses containing more than **25 choices**. Always use `.slice(0, 25)` on your returned array to remain safe.
4. **No Prefix Command Side Effects:** Since prefix text messages (`jb.play query`) do not trigger autocomplete, the `autocomplete` callback is completely and safely ignored by prefix routers. You do not need to write any branching logic to handle prefix triggers!
