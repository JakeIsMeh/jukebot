# Framework Architecture & Extensibility Reference

This document outlines the core principles of the Functional Pipeline Framework, designed to balance strict type safety with high configurability.

---

## 1. Core Philosophy: The "Workbench" vs. The "Cage"

Most bot frameworks are **Cages**: they hide the underlying API and force you to use their specific abstractions. This framework is a **Workbench**: it standardizes common tasks (replies, middleware, logging) but always exposes the raw power of the underlying library.

### The Three-Layer Isolation

1. **The Pipeline (`src/framework/index.ts`)**: Manages the logic flow, onion middleware nesting, and type-safe data merging. It doesn't care about Discord; it only cares about execution order and context composition.
2. **The Context (`Context` Interface)**: The "Standardized Suitcase." It holds everything a command needs. If you need a new tool, you add a pocket to the suitcase.
3. **The Adapter (`src/main.ts` & `Framework.handleX`)**: The "Translator." `src/main.ts` acts as the entry dispatcher, capturing raw Discord events (Interactions/Messages) and passing them to the framework's modular adapters (`handleInteraction`/`handleMessage`), which normalize them into the Context.

---

## 2. Future-Proofing Configurability

### The "Escape Hatch" Principle

Never hide the raw objects. Because the `Context` exposes `ctx.interaction` and `ctx.message`, you are never blocked by the framework.

- **Framework supported:** `await ctx.reply("Hello", { flags: [MessageFlags.Ephemeral] })`
- **Direct API (Edge cases):** `await ctx.interaction.editReply({ components: [...] })`

### Compositional Flags & Bitfields

By passing options and raw flags, the framework stays lean. We don't need to add a new property every time Discord adds a new message flag.

```typescript
// Compositional flags allow for any combination of Discord features
await ctx.reply('Content', {
	flags: [MessageFlags.Ephemeral, MessageFlags.SuppressEmbeds],
});
```

---

## 3. Extensibility Patterns

### Higher-Order Middlewares (Factories)

Don't hardcode logic into middlewares. Write functions that return middlewares to allow per-command configuration.

```typescript
import { Middleware, DataObject } from '../framework/index';
import { PermissionFlagsBits } from 'discord.js';

export const requirePermission = (perm: bigint): Middleware<DataObject, DataObject> => {
	return async (ctx, next) => {
		if (!ctx.member?.permissions.has(perm)) {
			return `❌ Missing permission: ${perm}`;
		}
		return await next(ctx);
	};
};

// Usage in a pipeline
const p = new Pipeline().use(requirePermission(PermissionFlagsBits.ManageMessages));
```

### Dependency Injection

To provide global services (e.g., Databases, Player Managers, APIs) to all commands, inject them into the `baseCtx` inside the [src/main.ts](file:///D:/GitCode/jukebot/src/main.ts) event listeners.

```typescript
// In src/main.ts
const baseCtx = {
	...
	db: myDatabaseInstance, // Make sure to add this type to the Context interface
};
```

---

## 4. Troubleshooting & Maintenance

### Duplicate Commands ("Ghosts")

If a command appears twice in the `/` menu, you have both a **Global** registration and a **Guild** (local dev guild) registration active.

- **Instant Update:** Provide a `DEV_GUILD_ID` in your `.env` to perform instant local command synchronization during development.
- **Clear Ghosts:** The framework automatically clears global ghost commands when `syncCommands` is executed in dev mode with a guild ID (`clearOthers = true`).

### Type Safety Guardrails

1. **Keep Data Objects Spread-Friendly:** Always ensure generics `TIn` and `TOut` extend `DataObject` (`Record<string, unknown>`) to allow context expansion and the `{ ...ctx.data, ...newData }` composition operator.
2. **Use the Onion Flow Correctly:** When writing middleware, **always** ensure that you either:
   - Call and return `await next(nextCtx)` to pass control downstream.
   - Call `await ctx.reply(...)` and return early (without calling `next`) to abort execution and reply to the user.
   - Run a fully custom fallback response or error boundary.

---

## 5. Why it’s Lean

This framework replaces **boilerplate code** with **TypeScript Generics**.

- **No Decorators:** No hidden metadata or reflection APIs.
- **No Folder Scanning:** No "magic" side effects or implicit imports.
- **No Class Inheritance:** No complex `super()` calls or rigid class hierarchies.

It is a "Type-Safe Tunnel": data goes in one end, gets transformed by pipes, and comes out the other end perfectly typed.
