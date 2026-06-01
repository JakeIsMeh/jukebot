# Developer Guide: Writing Your First Command

This guide walks a developer through creating a new command from scratch using our configuration-driven pipeline architecture and declarative option schemas.

---

## Step 1: Write Your Command Logic

Create a new file inside the `src/commands/` directory, for example: `src/commands/volume.ts`.

You will create a standalone configuration object using the **`defineCommand`** helper, specifying a static options schema. A command file must never contain global side effects or run code outside its declaration. It simply exposes a clean, typed data structure.

```typescript
import { Pipeline, defineCommand, InferSchemaTypes } from '../framework/index';
import { inVoice } from '../middleware';
import { VoiceBasedChannel } from 'discord.js';

// 1. Declare the Option Schema
const options = {
	level: { type: 'string', description: 'The volume target percentage', required: true },
} as const;

// 2. Build the Pipeline Chain (passing voiceChannel state and the inferred options schema types)
const volumePipeline = new Pipeline<
	{ voiceChannel: VoiceBasedChannel },
	InferSchemaTypes<typeof options>
>()
	.use(inVoice) // Enforces that the user is in a voice channel and injects voiceChannel
	.run(async (ctx) => {
		// Zero branching, zero manual checks! Strongly-typed options from schema validation!
		const input = ctx.options.level;
		const volumeLevel = parseInt(input, 10);

		if (isNaN(volumeLevel) || volumeLevel < 1 || volumeLevel > 100) {
			await ctx.reply('❌ Please specify a valid volume level between 1 and 100!');
			return;
		}

		// Access the data safely injected and typed by the 'inVoice' middleware
		const vc = ctx.data.voiceChannel;

		ctx.log.info('Adjusting bot stream volume state', { new_volume: volumeLevel });

		await ctx.reply(`🔊 Volume adjusted to **${volumeLevel}%** inside **${vc.name}**!`);
	});

// 3. Export the Uniform Configuration Block using defineCommand
export const volumeCommand = defineCommand({
	name: 'volume',
	description: 'Adjusts the audio playback volume level',
	aliases: ['vol', 'v'], // Support for prefix text shortcuts
	options,
	pipeline: volumePipeline,
});
```

---

## Step 2: Register the Command Natively

Open [src/main.ts](file:///D:/GitCode/jukebot/src/main.ts). To make your new feature instantly available to the bot across both Slash Commands and Text Messages, import your configuration block and attach it to the centralized app instance using the `.command()` builder method:

```typescript
// src/main.ts
import { Framework } from './framework/index';
import { playCommand } from './commands/play';
import { volumeCommand } from './commands/volume'; // 1. Import your file

const app = new Framework().command(playCommand).command(volumeCommand); // 2. Add it to the registration chain
```

That's it! Your command is fully integrated. The options schema will automatically compile into Discord's Slash Command builders at startup and provide automatic type-checking and runtime validation for prefix messages.

---

## Best Practices for Command Authors

1. **Keep Commands Stateless:** Commands should be stateless. If you need dynamic state (like a voice player state or queue), access it via a singleton player manager or pass it through an injection middleware.
2. **Utilize `ctx.log` Instead of `console.log`:** Every command context includes a trace-linked child logger. When you log messages via `ctx.log.info('message', { data })`, the output is tagged with telemetry identifiers that help trace execution steps.
3. **Always Return Early on Error:** If a check or user input is invalid, immediately execute `await ctx.reply('Error message')` and `return`. This keeps your execution blocks flat, clean, and easy to audit.
