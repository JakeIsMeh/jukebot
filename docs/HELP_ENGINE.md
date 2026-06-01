# Telemetry Guide: The Self-Documenting Help Engine

Because our framework is fully configuration-driven and utilizes a declarative options schema, the bot inherently stores rich metadata about every command (names, descriptions, aliases, arguments, types, and required constraints).

The framework leverages this metadata to provide a **completely automated, self-documenting help system** out-of-the-box, requiring **zero manual help-text maintenance**.

---

## 1. How It Works under the Hood

### A. The Core Metadata Parser

The `Framework` class exposes a high-level public helper method:

```typescript
app.generateHelp(commandQuery?: string, prefix = 'jb.'): string
```

- **Global Help Menu:** If called without arguments, it scans all registered commands and lists their names, descriptions, and aliases, prompting the user on how to inspect specific options.
- **Detailed Command Specs:** If a query is provided (which automatically resolves command aliases as well!), it extracts the targeted option schema and prints a precise list of arguments, including their types (`string`, `integer`, `number`, `boolean`), required constraints, and aliases.

### B. Dependency Injection via `ctx.framework`

To make the help engine easily queryable inside command pipelines, the framework automatically injects the active centralized `Framework` instance onto all execution payloads as **`ctx.framework`**:

```typescript
export interface Context<...> {
	...
	framework: Framework; // Dynamic link to the active framework
}
```

---

## 2. Quick Integration: The Pre-Built `helpCommand`

For maximum convenience, the framework exports a pre-built, production-ready `helpCommand` directly from its root.

This built-in help command renders a **stunning, state-of-the-art interactive experience**:

- **Rich Embeds:** All help pages (global menu and detailed command specifications) are cleanly displayed inside premium-colored Discord Rich Embed boxes.
- **Button Pagination:** If a help menu contains too many commands (exceeding the page limit) or a specific command has too many options, it automatically segments them into distinct pages and adds functional **◀️ Previous** and **Next ▶️** component buttons.
- **User Safety Enforcement:** Buttons only respond to the user who requested the help command (other users trying to navigate will see a silent warning).
- **Graceful Timeouts:** Button components are disabled automatically after 60 seconds of inactivity to keep message states clean.

To enable this fully functional help command on your bot (active across both slash commands and prefix messages), simply import and register it inside [src/main.ts](file:///D:/GitCode/jukebot/src/main.ts):

```typescript
// src/main.ts
import { playCommand } from './commands/play';
import { Framework, helpCommand } from './framework/index'; // 1. Import it

const app = new Framework().command(playCommand).command(helpCommand); // 2. Natively register it!
```

---

## 3. Creating a Custom Help Command

If you want a highly customized help display (e.g. rendering beautiful Discord Rich Embeds or adding special styling), you can bypass the pre-built command and write your own custom handler inside `src/commands/help.ts` using `ctx.framework`:

```typescript
// src/commands/help.ts
import { Pipeline, defineCommand, InferSchemaTypes } from '../framework/index';
import { EmbedBuilder } from 'discord.js';

const options = {
	command: { type: 'string', description: 'The specific command to inspect', required: false },
} as const;

const helpPipeline = new Pipeline<{}, InferSchemaTypes<typeof options>>().run(async (ctx) => {
	const query = ctx.options.command;
	const displayPrefix = ctx.type === 'prefix' ? 'jb.' : '/';

	// 1. Query the framework metadata
	const rawHelp = ctx.framework.generateHelp(query, displayPrefix);

	// 2. Render custom Discord Embeds
	const embed = new EmbedBuilder().setColor('#00ffcc').setDescription(rawHelp);

	await ctx.reply({ embeds: [embed] });
});

export const helpCommand = defineCommand({
	name: 'help',
	description: 'Displays command specs and helper guides',
	aliases: ['h'],
	options,
	pipeline: helpPipeline,
});
```

---

## 4. Best Practices

1. **Keep Descriptions Clear:** Since descriptions in your option schema populate both Discord's Slash Command menus and the text help pages, make sure they are concise and meaningful.
2. **Keep Aliases Unique:** If two commands use the same alias, the framework's alias mapper will resolve to the last registered command.
3. **Use the `greedy` Feature Natively:** The last `'string'` argument in a prefix command automatically acts as a greedy argument, consuming all remaining words. This makes argument formatting incredibly natural for commands like `help` or `play`.

---

## 5. Abbreviated Option Error Help

When a user calls a prefix command with invalid inputs or missing required arguments, the command parser will:

1. Aggregate **all** errors found across the arguments (e.g. both wrong types and missing required arguments).
2. Generate an **abbreviated command usage help block** showing only the wrong or missing options.
3. Automatically reply with this abbreviated help page so the user knows exactly how to fix their invocation without reading through the full help page.

### Example Output

If a user runs `jb.play` without providing the required `query` parameter:

```
❌ **Invalid Command Arguments**

💡 **Usage: play**
*The following option(s) are wrong or missing:*
• `query` *(string, required)* - **Missing required option**
  *Description:* Song name or URL
```

---

## 6. Subcommand Help Indexing

If a command utilizes the **UX-First Coexistence Bridge** or has subcommands registered:

1. **Global Index Nesting:** The pre-built `help` command automatically displays subcommands nested directly beneath the parent command as bullet points:
   ```
   • **queue** - View or manage the music queue
     ↳ *Subcommands:* `view`*(default)*, `clear`
   ```
2. **Subcommand Specifications Querying:** Users can query the exact options, types, required flags, and aliases of a subcommand by passing the space-separated path as the query:
   - Prefix example: `jb.help queue clear`
   - Slash example: `/help command:queue clear`
3. This dynamically segments and paginates subcommand options identically to parent options, providing absolute schema visibility!
