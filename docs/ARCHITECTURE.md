# Architecture Guide: The Pipeline & Context Engine

This document explains the two core elements that make the developer experience in this framework unique: the **Unified Context** and the **Chained Onion Pipeline**.

---

## 1. The Unified Context Object

In standard Discord development, writing a bot that supports both text messages (`jb.play`) and Slash Commands (`/play`) usually requires writing two separate command handlers or massive conditional branches.

Our framework solves this by introducing a **Unified Context** interface (`Context<TData>`). When an event occurs, the engine instantly maps the disparate elements into a completely unified interface:

| Property          | Description                                                                                                                                               |
| :---------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.interaction` | The native Discord interaction instance (null if triggered via a prefix text message).                                                                    |
| `ctx.message`     | The native Discord message instance (null if triggered via a Slash Command).                                                                              |
| `ctx.type`        | A string literal matching either `'slash'` or `'prefix'`.                                                                                                 |
| `ctx.author`      | The unified `User` object of the person who initiated the execution.                                                                                      |
| `ctx.member`      | The `GuildMember` object (permissions, voice states) of the caller.                                                                                       |
| `ctx.channel`     | The text channel where the response must be routed.                                                                                                       |
| `ctx.reply()`     | A standardized, asynchronous function that responds directly to the user safely, handles interaction replies/followUps, or falls back to message replies. |
| `ctx.data`        | A completely isolated, read-only state bucket where middlewares inject type-safe data properties.                                                         |
| `ctx.log`         | A contextual child logger bound explicitly to this single request, configured with a unique tracking trace.                                               |
| `ctx.push()`      | Helper method to construct a new context with merged data, returning a typed `Context<TData & TNew>`.                                                     |

---

## 2. The Chained Onion Pipeline Builder

To manage complex state progression and middleware nesting without losing type information, the framework utilizes a **Fluent Onion Pipeline Builder Pattern**.

When you write a command, you initialize a new `Pipeline` object and chain operations using the `.use()` method:

```typescript
const musicPipeline = new Pipeline()
	.use(performanceTimer) // Step 1: Hooks before/after execution timing
	.use(inVoice) // Step 2: Validates voice state, injects { voiceChannel: VoiceBasedChannel }
	.use(inSameVoice) // Step 3: Consumes { voiceChannel } from data to validate voice matching
	.run(async (ctx) => {
		// Step 4: Your command execution code with full access to ctx.data.voiceChannel
	});
```

### Why this design was chosen

Traditional middleware arrays (`middleware: [performanceTimer, inVoice, inSameVoice]`) have a major flaw in TypeScript: **type information is lost**. When one middleware injects property `voiceChannel` into the context, a downstream middleware or handler inside an array cannot automatically know it is present. The developer is forced to use manual type assertions (`as VoiceBasedChannel`) or type-guards.

The Builder pattern solves this using **method-chaining generics**. Every time you call `.use()`, the Pipeline class:

1. Absorbs the old type state `TData`.
2. Receives a middleware that matches `Middleware<TData, TNewData>`.
3. Returns a _new_ `Pipeline<TData & TNewData>` instance.

This creates a linear compiler type track:

```
1. Pipeline<{}>
2. .use(inVoice)      ──► Returns Pipeline<{ voiceChannel: VoiceBasedChannel }>
3. .use(inSameVoice)  ──► Returns Pipeline<{ voiceChannel: VoiceBasedChannel }>
4. .run(handler)      ──► Passes Context<{ voiceChannel: VoiceBasedChannel }> directly to the handler
```

### Onion Middleware Execution Flow

Unlike a flat list of serial functions, our pipeline uses an **Onion (CPS - Continuation Passing Style) model** similar to Koa.js. A middleware is declared as:

```typescript
export type Middleware<TIn extends DataObject, TOut extends DataObject> = (
	ctx: Context<TIn>,
	next: (ctx: Context<TIn & TOut>) => Promise<void>,
) => Promise<void>;
```

This model is extremely powerful because:

- **Control over downstream flow:** The middleware explicitly decides when to pass control to downstream middlewares/handlers by calling `await next(nextCtx)`.
- **Before/After Execution:** The middleware can run logic _before_ calling `next()`, and then run cleanup/telemetry logic _after_ the next promise resolves. For example:
  ```typescript
  export const performanceTimer: Middleware<DataObject, DataObject> = async (ctx, next) => {
  	const start = performance.now(); // 1. Logic BEFORE
  	await next(ctx); // 2. Downstream execution happens here
  	const end = performance.now(); // 3. Logic AFTER
  	ctx.log.info(`⏱️ Execution took ${(end - start).toFixed(2)}ms`);
  };
  ```
- **Halting the Pipeline:** If a validation check fails (e.g. user is not in voice), the middleware can simply call `await ctx.reply(...)` to reply to the user and return early **without calling `next()`**. The framework runner detects that the context has been replied to and automatically halts downstream execution, preventing double-reply issues.

---

## 3. The Compile-Time Dependency Injection (DI) Engine

When scaling a bot, you frequently need to reference global singletons (e.g. database pools, redis clients, lavalink music players) inside your command pipelines. The framework provides a **100% type-safe, compile-time validated Dependency Injection (IoC) system** natively.

### A. Registering Services on the Framework

Register singletons using the fluent `.provide(key, value)` builder chain on your centralized `Framework` instance:

```typescript
// src/main.ts
import { Framework } from './framework/index';
import { DatabasePool } from './db';
import { MusicPlayer } from './player';

const app = new Framework({ prefix: 'jb.' })
	.provide('db', new DatabasePool())
	.provide('player', new MusicPlayer());
```

Each call to `.provide()` expands the generic `TServices` parameter of the `Framework` instance.

### B. Accessing Injected Services inside Pipelines

Commands simply specify their required dependency interfaces in the pipeline's third generic parameter.

```typescript
// src/commands/play.ts
import { Pipeline, defineCommand } from '../framework/index';
import { MusicPlayer } from '../player';

// Define the required service contract for this command file
interface PlayServices {
	player: MusicPlayer;
}

const playPipeline = new Pipeline<
	{}, // Local state data
	{ query: string }, // Options schema types
	PlayServices // 🚀 Require 'player' service to compile!
>().run(async (ctx) => {
	const trackQuery = ctx.options.query;

	// 100% type-safe access to your injected services!
	const musicPlayer = ctx.services.player;

	await musicPlayer.play(ctx.member?.voice.channel, trackQuery);
	await ctx.reply(`🎸 Playing track!`);
});
```

### C. Compile-Time Registration Safety

Because the DI engine validates services at compile time, if a command requires `PlayServices` (expects `player`), but the framework in `main.ts` fails to register it, **TypeScript will raise a compilation error!**

This prevents missing dependency runtime bugs completely.
