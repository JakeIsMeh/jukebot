# Developer Guide: Writing Onion Middleware

Middlewares in this framework are the building blocks used to secure commands, validate permissions, verify voice connection states, and inject dynamic services.

This guide details how to write, chain, and structure middlewares using our **type-safe, onion-style pipeline architecture**.

---

## 1. What is "Onion" Middleware?

Middlewares are structured using an **Onion (Continuation Passing Style - CPS) model** similar to Koa.js or Hono.

A middleware wraps all downstream execution. It receives two parameters: the current `ctx` (Context) and a `next` callback.

```
                         Onion Middleware Loop
               +───────────────────────────────────────+
               |  Middleware 1 (performanceTimer)      |
               |   [Before: performance.now()]         |
               |      │                                |
               |      ▼                                |
               |   +───────────────────────────────+   |
               |   |  Middleware 2 (inVoice)       |   |
[Event] ──────►│──►│──► [Check VC presence]        |   |
               |   |     │                         |   |
               |   |     ▼                         |   |
               |   |   +───────────────────────+   |   |
               |   |   |     Main Handler      |   |   |
               |   |──►│──►  [Execute command] │   |   |
               |   |   +───────────────────────+   |   |
               |   |     │                         |   |
               |   |     ▼                         |   |
               |   |    [Return control]           |   |
               |   |◄──────────────────────────────┘   |
               |   +───────────────────────────────+   |
               |      │                                |
               |      ▼                                |
               |   [After: Log elapsed execution]      |
               |◄──────────────────────────────────────┘
[Finished] ◄───┘
```

Because control flows through `next()`, a middleware has full power to run logic **before** the command execution (e.g. state validation) and **after** the command has completed (e.g. execution timing, cleanups).

---

## 2. Defining Middlewares using `defineMiddleware`

To write a middleware, use the **`defineMiddleware`** helper. This helper is a zero-runtime-cost identity wrapper that provides full autocomplete and strict generic inference inside your IDE.

```typescript
import { defineMiddleware, DataObject } from './framework/index';

export const myMiddleware = defineMiddleware<TIn, TOut>(async (ctx, next) => {
	// ... logic goes here ...
});
```

### Generic Type Mathematics

Middlewares are strongly typed with two parameters:

1. `TIn` (Incoming Data): The properties that _must_ already exist on `ctx.data` before this middleware runs.
2. `TOut` (Outgoing Data): The properties that this middleware guarantees it will inject onto `ctx.data` before passing control downstream.

For example, our `inVoice` middleware requires nothing to be present in `ctx.data` (`{}`), but it guarantees it will discover and inject `voiceChannel`:

```typescript
import { VoiceBasedChannel } from 'discord.js';

export const inVoice = defineMiddleware<{}, { voiceChannel: VoiceBasedChannel }>(
	async (ctx, next) => {
		const channel = ctx.member?.voice.channel;
		if (!channel) {
			await ctx.reply('❌ You must be in a voice channel!');
			return; // Halt execution early
		}

		// 100% type-safe injection. We pass a modified context downstream.
		await next({
			...ctx,
			data: { ...ctx.data, voiceChannel: channel },
		});
	},
);
```

---

## 3. Control Flow: Halting vs. Continuing

A middleware decides whether to let the request continue or to block it.

### A. Halting Early

If a validation check fails, you halt execution by **calling `ctx.reply` and returning early _without_ calling `next()`**:

```typescript
if (isBlacklisted) {
	await ctx.reply('❌ You are blacklisted!');
	return; // 🛑 Halt! Downstream commands and middlewares never run.
}
```

### B. Continuing Downstream

If validation succeeds, you continue execution by **calling `await next(nextCtx)`**:

```typescript
// Pass control to the next middleware/handler
await next(ctx);
```

---

## 4. The Runtime Double-Reply Guard

Because Discord interactions can only be acknowledged/replied to _exactly once_, calling `ctx.reply(...)` and then accidentally invoking `next()` is a dangerous bug that would normally crash your bot.

To eliminate this cognitive load, the framework includes a **strict runtime safeguard**:

```typescript
// ❌ Buggy Control Flow
export const buggyMiddleware = defineMiddleware(async (ctx, next) => {
	await ctx.reply('❌ Something went wrong!');
	await next(ctx); // 🛑 THROWS PIPELINE GUARD VIOLATION!
});
```

### The Guard Mechanism

1. A clone-safe getter `replied` tracks the acknowledgment state of the request.
2. If `ctx.reply()` is called, `replied` is set to `true`.
3. If `next()` is subsequently invoked, the framework catches the violation, terminates the pipeline immediately, logs a stack trace, and throws a highly debuggable error:
   > `🛑 Pipeline Guard Violation: next() was called in middleware "buggyMiddleware" after a reply was already sent to Discord. Make sure to early-return (e.g. return;) and NOT call next() after calling ctx.reply() inside your middleware!`

---

## 5. Middleware Factories (Parameterized Middleware)

If you need to configure a middleware per-command (e.g., specifying a required permission node), write a **higher-order function** that returns a middleware:

```typescript
import { defineMiddleware, DataObject } from '../framework/index';
import { PermissionFlagsBits } from 'discord.js';

export const requirePermission = (permissionNode: bigint) => {
	return defineMiddleware<DataObject, DataObject>(async (ctx, next) => {
		if (!ctx.member?.permissions.has(permissionNode)) {
			await ctx.reply("❌ You do not have the required permissions to use this command!");
			return; // Halt
		}
		await next(ctx); // Continue
	});
};

// Usage inside a command pipeline:
const adminPipeline = new Pipeline()
	.use(requirePermission(PermissionFlagsBits.Administrator))
	.run(async (ctx) => { ... });
```

---

## 6. Best Practices for Middleware Authors

1. **Always Await `next()`:** Always write `await next(ctx)` rather than firing it asynchronously. This ensures that "after" timing and error boundaries execute in the correct linear order.
2. **Never Call `next()` Twice:** A middleware must call `next()` at most once. Calling it multiple times will trigger a stack crash.
3. **Always Return on Halt:** Always pair `await ctx.reply(...)` with a direct `return;` on the next line to ensure clean control flow.

---

## 7. Global Middlewares

If you want to apply a middleware to **every single command registered on your bot** (such as logging execution metrics, registering performance timers, or maintaining global telemetry), you can attach it globally directly to the central `Framework` instance using `app.use()`:

### Defining the Global Middleware

```typescript
// src/middleware.ts
import { defineMiddleware } from './framework/index';

export const performanceTimer = defineMiddleware(async (ctx, next) => {
	const start = performance.now();
	await next(ctx); // Continue down the pipeline
	const elapsed = (performance.now() - start).toFixed(2);
	ctx.log.info(`⏱️ Command execution completed`, { elapsed: `${elapsed}ms` });
});
```

### Registering It Globally

```typescript
// src/main.ts
import { Framework } from './framework/index';
import { performanceTimer } from './middleware';

const app = new Framework({ prefix: 'jb.' }).use(performanceTimer); // 🚀 Attached globally to ALL commands!
```

### Execution Order

When a command is triggered, global middlewares execute **first** (in the order they were registered via `app.use()`), wrapping the command's own pipeline. Only after all global middlewares have called `next()` will the command's own local middlewares and main handler execute!
