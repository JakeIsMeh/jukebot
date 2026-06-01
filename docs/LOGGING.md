# Telemetry Guide: Structured Context Logging

A major headache when developing complex bot applications (especially audio streaming bots) is tracing logs when multiple users execute commands simultaneously. This framework solves that by embedding an **observability-first, zero-allocation logging layer** straight into the execution pipeline using Node.js's native `AsyncLocalStorage`.

---

## How It Works under the Hood

When an interaction hits the application framework, the execution engine (`Framework.executePipeline`) assigns a random, 8-character string called a **Trace ID** using the high-performance `nanoid` library:

```typescript
const traceId = nanoid(8);
```

Instead of cloning and instantiating a new, heavy Consola child logger class instance on every single request, the framework employs two high-performance mechanisms:

1. **Logger Caching:** Static, command-specific logger instances (e.g. for `play`, `volume`) are created once and cached.
2. **`AsyncLocalStorage` Context Hooking:** The execution pipeline runs inside a native asynchronous context:
   ```typescript
   await logStorage.run({ command: route.name, trace_id: traceId }, async () => {
   	return await route.pipeline.execute(fullCtx, args);
   });
   ```

A single, global `requestLogger` proxy is passed to `ctx.log`. When you call `ctx.log.info()`, the logger:

- Looks up the active asynchronous execution store.
- If found, it fetches the pre-cached Consola logger for that command.
- Merges the `trace_id` dynamically into the log payload on the fly.
- If executed outside of a request context, it gracefully falls back to the system's root logger.

This gives you **fully decoupled, trace-correlated telemetry** with **zero memory allocation overhead** per log call.

---

## Logging Levels and Semantic Usage

When writing code inside your command handlers or validation middlewares, make sure to pick the correct log levels to maintain a clean tracking environment:

### `ctx.log.debug(message, metadata)`

Use this for detailed developer updates that you don’t need to see running constantly in production, such as looking up users or matching route parameters.

```typescript
ctx.log.debug('Checking voice state registration links...');
```

### `ctx.log.info(message, metadata)`

Use this for major workflow updates, such as successfully parsing parameters or beginning a track download stream.

```typescript
ctx.log.info('Successfully established connection packet downstream', { source: query });
```

### `ctx.log.warn(message, metadata)`

Use this when a pipeline steps back safely due to normal runtime conditions, such as a user inputting a bad parameter or failing a middleware check.

```typescript
ctx.log.warn('Pipeline execution rejected input arguments', { cause: 'User missing permissions' });
```

### `ctx.log.error(message, metadata, error)`

Use this exclusively for true internal code crashes, broken dependencies, or rejected promise catches. Pass the active `Error` instance as the third parameter to preserve full stack trace visibility.

```typescript
try {
	await database.save();
} catch (err: any) {
	ctx.log.error('Failed to commit user profile state updates', {}, err);
}
```

---

## Swapping the Telemetry Adapter

Our logging layer uses a clean, decoupled `Logger` interface inside [src/framework/logger.ts](file:///D:/GitCode/jukebot/src/framework/logger.ts). This means nothing in your actual business logic or command files directly depends on how `consola` prints messages.

If you want to stream these logs to an enterprise aggregator like Datadog, Grafana Tempo, or Honeycomb via OpenTelemetry later, you can swap out the backend inside [src/framework/logger.ts](file:///D:/GitCode/jukebot/src/framework/logger.ts) without touching a single command file. You simply implement the `Logger` interface using the native `@opentelemetry/api-logs` package, using `logStorage.getStore()` to map the trace context perfectly to your telemetry spans.
