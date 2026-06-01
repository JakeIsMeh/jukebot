# Framework Maintainer Guide: Core Engine Specifications

This document is intended exclusively for core framework maintainers. It outlines the design choices, generic math contracts, and operational execution mechanics behind the framework layer.

---

## 1. Type Engineering & Onion Composition

Older bot architectures typically rely on generic array declarations like `middleware: Middleware[]`. Because an array splits functions into separate array items, the compiler cannot naturally share type narrowing across items. A middleware that verified and injected a voice channel would leave the next middleware in the dark, necessitating unsafe type assertions (`as VoiceChannel`) or phantom fields.

This framework resolves this with a **Fluent Onion Pipeline Builder Pattern** using method-chaining generics:

```typescript
export type Middleware<TIn extends DataObject, TOut extends DataObject> = (
	ctx: Context<TIn>,
	next: (ctx: Context<TIn & TOut>) => Promise<void>,
) => Promise<void>;
```

### The Generic Math Contract of Chaining

When you call `.use()`, the `Pipeline` class absorbs the existing data signature `TData`, intercepts the new middleware's output type `TNewData`, and produces a _new_ generic `Pipeline` instance with intersected type boundaries:

```typescript
export class Pipeline<TData extends DataObject = DataObject> {
	private middlewares: Middleware<any, any>[] = [];

	use<TNewData extends DataObject>(
		middleware: Middleware<TData, TNewData>,
	): Pipeline<TData & TNewData> {
		const nextPipeline = new Pipeline<TData & TNewData>();
		nextPipeline.middlewares = [...this.middlewares, middleware];
		return nextPipeline;
	}

	run(
		handler: (ctx: Context<TData>, args: string[]) => Promise<void> | void,
	): CommandConfig<TData>['pipeline'] {
		return {
			execute: async (baseCtx, args) => {
				let index = -1;
				const dispatch = async (i: number, currentCtx: Context<any>): Promise<void> => {
					if (i <= index) throw new Error('next() called multiple times');
					index = i;

					if (i === this.middlewares.length) {
						await handler(currentCtx, args);
						return;
					}

					const fn = this.middlewares[i];
					return await fn(currentCtx, async (nextCtx) => {
						return await dispatch(i + 1, nextCtx);
					});
				};

				return await dispatch(0, baseCtx);
			},
		};
	}
}
```

### Mathematical Flow of Onion Composition

The composition works like a continuation reducer:

1. When the pipeline runs, `dispatch(0, baseCtx)` triggers the outermost middleware (`middlewares[0]`).
2. It decides when to trigger the downstream execution block by awaiting `next(nextCtx)`.
3. When `next` is invoked, it recurses to `dispatch(i + 1, nextCtx)` flowing into the next wrapped middleware until it hits the final command handler inside `.run()`.
4. Once the handler resolves, the control stack bubbles back out through the middlewares in reverse order (resolving their "after" logic).

This ensures **absolute compile-time and run-time safety** without manual casting and runs on a highly-optimized flat array structure.

---

## 2. The Internal Execution Loop Mechanics

The core routing loop inside `Framework.executePipeline` coordinates the pipeline execution. Below is the precise control-flow logic:

```
[Base Context Input]
       │
       ▼
Generate Unique Trace ID (nanoid) ──► logStorage.run (AsyncLocalStorage)
       │
       ▼
Invoke composed pipeline.execute(fullCtx, args):
  │
  ├──► Middleware 1 (Before next)
  │       │
  │       ▼
  ├──► Middleware 2 (Before next)
  │       │
  │       ▼
  ├──► Command Handler executes
  │       │
  │       ▼
  ├──► Middleware 2 (After next resolves)
  │       │
  │       ▼
  └──► Middleware 1 (After next resolves)
       │
       ▼
Pipeline completes ──► Central catch boundary checks if replied is false to send fallback error
```

### Critical Operational Safeguards

- **Unhandled Exception Boundaries:** The entire middleware loop is wrapped in a high-level try-catch block inside `executePipeline`. If any unhandled exception or database failure occurs anywhere inside a middleware or command handler, the error is safely caught, fully logged with its active trace ID, and the end-user receives a safe fallback message (`❌ Internal Error` marked as Ephemeral) without crashing the bot's core Node.js thread.
- **Context Immutability:** When state is updated, a new context layer is constructed using object spreads: `nextCtx = { ...ctx, data: { ...ctx.data, ...newData } }`. This prevents concurrent request leaks if the exact same middleware reference is running across separate execution contexts simultaneously.
- **Zero-Allocation Telemetry Context:** Command names and trace IDs are stored in Node.js's native `AsyncLocalStorage`. A single proxy logger is shared globally, reading active trace IDs dynamically out-of-band. Consola logger instances for commands are pre-cached, completely eliminating consola child-cloning memory allocations during request events.
