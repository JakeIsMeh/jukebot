# Welcome to the Composable Discord Framework

This bot codebase is built using a custom, **composable onion pipeline architecture**. If you have ever used modern web frameworks like Elysia, Hono, Koa, or Fastify, you will feel right at home.

Unlike traditional enterprise Discord frameworks that rely on heavy Object-Oriented Programming (OOP), complex class inheritance (`extends Command`), or hidden runtime side-effects (like automatic folder scanning), this framework is built entirely on **pure functions, data configurations, and explicit builders**.

---

## The Core Concept: Discord Interactions as a Composable Onion Pipeline

Every time a user invokes a slash command or types a prefixed text message, it enters our application as an incoming request. Instead of letting that request execute code in an ad-hoc manner, it flows through a **composable onion middleware pipeline**.

```
                           +----------------------------------------+
                           |           Onion Pipeline               |
                           |                                        |
[Incoming Event]           |   +--------------------------------+   |
       │                   |   |         Middleware 1           |   |
       ▼                   |   |       (performanceTimer)       |   |
[Context Normalization] ──►│──►│──► [Before: performance.now()] |   |
                           |   |                │               |   |
                           |   |                ▼               |   |
                           |   |   +------------------------+   |   |
                           |   |   |      Middleware 2      |   |   |
                           |   |   |        (inVoice)       |   |   |
                           |   |──►│──► [Check VC presence] |   |   |   |
                           |   |   |            │           |   |   |   |
                           |   |   |            ▼           |   |   |   |
                           |   |   |   +----------------+   |   |   |   |
                           |   |   |   |  Main Handler  |   |   |   |   |
                           |   |   |   |     (play)     |   |   |   |   |
                           |   |   |──►│──► [Run play]  │   |   |   |   |
                           |   |   |   +----------------+   |   |   |   |
                           |   |   |            │           |   |   |   |
                           |   |   |            ▼           |   |   |   |
                           |   |   |     [next() returns]   │   |   |   |
                           |   |   |◄───────────────────────┘   |   |   |
                           |   |   +------------------------+   |   |   |
                           |   |                │               |   |   |
                           |   |                ▼               |   |   |
                           |   |    [After: Log duration]       │   |   |
                           |   |◄───────────────────────────────┘   |   |
                           |   +--------------------------------+   |   |
[Command Finished] ◄───────│◄───────────────────────────────────────┘   |
                           +----------------------------------------+
```

1. **The Event is Intercepted:** The bot catches the Slash Command or Text Message (`jb.play`).
2. **Context is Normalized:** The framework builds a unified `Context` object. Whether the action came from a Slash Command or an old-school text message, your downstream code interacts with it exactly the same way.
3. **Onion Middlewares Execute:** The request flows down a chain of middleware functions. Each middleware can execute code _before_ passing control to the next handler by calling `next()`, and then execute code _after_ the next handler completes.
4. **Data Injection and Type Safety:** Middlewares can verify the request (e.g., "Is the user in a voice channel?") and attach new, strongly-typed data directly onto `ctx.data` using context composition.
5. **The Handler Executes:** Once the chain reaches the end of the pipeline, the command handler runs with absolute type confidence—guaranteeing that the data injected by previous middlewares is present and ready to use.

---

## Structural Anatomy of the Codebase

When you open the `src/` directory, you will find a minimal, highly structured footprint:

- **[src/main.ts](file:///D:/GitCode/jukebot/src/main.ts)**: The explicit application engine. This is where the Discord client connects, events (both slash commands and prefix messages) are routed, and commands are registered.
- **[src/middleware.ts](file:///D:/GitCode/jukebot/src/middleware.ts)**: Reusable onion middleware blocks that protect and enhance execution (e.g., `inVoice`, `inSameVoice`, and `performanceTimer`).
- **[src/framework/index.ts](file:///D:/GitCode/jukebot/src/framework/index.ts)**: The framework architecture layer. It houses the pipeline builders, onion composition logic, context specifications, and command syncing mechanisms.
- **[src/framework/logger.ts](file:///D:/GitCode/jukebot/src/framework/logger.ts)**: The telemetry layer. It abstracts `consola` to support trace-based request logging.
- **[src/commands/](file:///D:/GitCode/jukebot/src/commands/)**: A flat, un-magical folder where individual command objects are declared and exported.

---

## How to Navigate Efficiently

- **To see what features the bot has:** Look directly inside [src/main.ts](file:///D:/GitCode/jukebot/src/main.ts). Because we avoid side-effectful imports or directory scanners, every command the bot supports is explicitly passed to the framework builder on startup.
- **To check validation criteria:** If a command says it requires you to be in a voice channel, look at [src/middleware.ts](file:///D:/GitCode/jukebot/src/middleware.ts) to see how that constraint is applied and what data it passes along.
- **To learn how to write middlewares:** Refer to the comprehensive [Onion Middleware Developer Guide](file:///D:/GitCode/jukebot/docs/MIDDLEWARE.md) to understand onion execution loops, generic types, and early halting.
- **To understand the self-documenting help system:** Refer to the comprehensive [Self-Documenting Help Engine Guide](file:///D:/GitCode/jukebot/docs/HELP_ENGINE.md) to learn how command metadata auto-generates dynamic Discord help pages.
- **To implement autocomplete suggestion lists:** Refer to the comprehensive [Slash Command Autocomplete Guide](file:///D:/GitCode/jukebot/docs/AUTOCOMPLETE.md) to learn how option autocompletion handles search queries.
- **To update a command:** Simply find the command file inside [src/commands/](file:///D:/GitCode/jukebot/src/commands/). The data options, aliases, and logic all live inside that single object.
