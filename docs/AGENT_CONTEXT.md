# Agent Context: Framework Specifications & Constraints

This document is a technical reference guide for AI coding assistants to quickly onboard and modify this bot framework.

---

## 1. Core Architectural Constraints

- **Zero Dependencies:** The framework relies solely on `discord.js`, `consola` (for logging), and `nanoid` (for trace ID generation). Do not add external router or schema packages (like `zod` or `valibot`).
- **Explicit Configurations:** The framework rejects filesystem-scanning side effects or implicit imports. All commands, middlewares, and services must be explicitly imported and registered via the central `Framework` builder.
- **Bi-Modal Event Handlers:** Commands must support both prefix text messages (positional parsing) and native slash commands (interaction payloads) through a single unified context interface.

---

## 2. Type Architecture

The framework relies on structural TypeScript generic propagation to maintain type safety:

### A. Context Generic Parameters

```typescript
export interface Context<
	TData extends DataObject = DataObject,
	TOptions extends Record<string, any> = Record<string, any>,
	TServices extends Record<string, any> = Record<string, any>,
> { ... }
```

1. `TData`: Isolated request state injected by middlewares.
2. `TOptions`: Primary command options inferred from the declarative schema.
3. `TServices`: Singleton service classes registered at startup.

### B. Fluent Pipeline Builder

The `Pipeline` class utilizes method-chaining generic propagation to build the middleware stack. Every `.use()` call merges incoming and outgoing state shapes, delivering a compiled `Context` payload to the final handler.

```typescript
export class Pipeline<TData, TOptions, TServices> {
	use<TNewData>(
		middleware: Middleware<TData, TNewData, TServices>,
	): Pipeline<TData & TNewData, TOptions, TServices>;
	run(
		handler: (ctx: Context<TData, TOptions, TServices>, args: string[]) => void,
	): CommandConfig<TData, any, TServices>['pipeline'];
}
```

---

## 3. Directory Layout & Source Code Map

- `src/framework/types.ts`: Base interfaces (`Context`, `CommandOption`, `CommandConfig`, `SubcommandConfig`) and nominal identity helpers (`defineCommand`, `defineSubcommand`, `defineMiddleware`).
- `src/framework/pipeline.ts`: Onion-style middleware dispatcher utilizing Continuation Passing Style (CPS) execution loops.
- `src/framework/engine.ts`: Core `Framework` class handling slash commands autocomplete, subcommands routing, prefix command parsing, and Discord REST API synchronization.
- `src/framework/help.ts`: Built-in pre-formatted `helpCommand` with automated embed segmenting and dynamic button pagination.
- `src/middleware.ts`: Reusable pipeline middleware definitions (e.g., voice channel validation guards, performance timers).
- `src/commands/`: Concrete command configuration modules (e.g., `play.ts`).

---

## 4. Subcommand Routing & Coexistence Bridge

To bridge the gap between Discord's strict slash subcommand constraints and prefix CLI conventions, the framework implements a **UX-First Coexistence Bridge**:

- **Properties:** A parent `CommandConfig` can define `subcommands: SubcommandConfig[]` and `defaultSubcommand: string` (e.g. `'view'`).
- **Slash Commands:** The framework automatically registers a virtual subcommand under the `defaultSubcommand` name, routing it back to the parent command's base pipeline.
- **Prefix Commands:** If the first argument matches a subcommand name/alias, it shifts the arguments and runs the subcommand's pipeline. If it is empty or matches `defaultSubcommand`, it falls back to the parent command's base pipeline.

---

## 5. Rules for Modifying This Codebase

When writing code or modifying features in this repository, you must observe these strict constraints:

1. **Keep Commands Stateless:** Never store runtime state in command files. All state must live in injected service singletons or be passed downstream in `ctx.data`.
2. **Generic Parameter Orders:** When defining config types, the generic parameters must remain in this exact order: `_TData`, `TServices`, then `TOptions`. This ensures default parameters resolve correctly.
3. **No User Pings on Errors:** Prefix command validation error replies must always pass `allowedMentions: { repliedUser: false }` to avoid unwanted pings.
4. **Aggregated Options Validation:** The prefix command parser must validate all arguments first, gathering any missing or wrong inputs into an aggregated array, and outputting a single cohesive abbreviated help page.
5. **No console.log:** Always use `ctx.log` (or `requestLogger`) to write messages. This ensures logs are trace-linked with unique tracking identifiers.
6. **Double-Reply Guard:** Middlewares must never call `next()` after responding to the request (`ctx.reply()`). Pair replies with a direct `return;` to avoid pipeline violations.
7. **Barrels Imports:** Command files must always import core types from the barrel root: `import { ... } from '../framework/index'`.
