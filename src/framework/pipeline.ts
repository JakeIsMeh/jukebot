import { requestLogger } from './logger';
import { DataObject, Context, Middleware, CommandConfig } from './types';

export class Pipeline<
	TData extends DataObject = DataObject,
	TOptions extends Record<string, any> = Record<string, any>,
	TServices extends Record<string, any> = Record<string, any>,
> {
	private middlewares: Middleware<any, any, TServices>[] = [];

	use<TNewData extends DataObject>(
		middleware: Middleware<TData, TNewData, TServices>,
	): Pipeline<TData & TNewData, TOptions, TServices> {
		const nextPipeline = new Pipeline<TData & TNewData, TOptions, TServices>();
		nextPipeline.middlewares = [...this.middlewares, middleware];
		return nextPipeline;
	}

	run(
		handler: (ctx: Context<TData, TOptions, TServices>, args: string[]) => Promise<void> | void,
	): CommandConfig<TData, any, TServices>['pipeline'] {
		return {
			execute: async (baseCtx, args) => {
				let index = -1;
				const dispatch = async (
					i: number,
					currentCtx: Context<any, any, TServices>,
				): Promise<void> => {
					if (i <= index) throw new Error('next() called multiple times');
					index = i;

					if (i === this.middlewares.length) {
						await handler(currentCtx as any, args);
						return;
					}

					const fn = this.middlewares[i];
					await fn(currentCtx, async (nextCtx) => {
						if (currentCtx.replied) {
							const middlewareName = fn.name || 'anonymous';
							const err = new Error(
								`🛑 Pipeline Guard Violation: next() was called in middleware "${middlewareName}" after a reply was already sent to Discord. ` +
									`Make sure to early-return (e.g. return;) and NOT call next() after calling ctx.reply() inside your middleware!`,
							);
							requestLogger.error(err.message, {}, err);
							throw err;
						}
						await dispatch(i + 1, nextCtx);
					});
				};

				await dispatch(0, baseCtx);
			},
		};
	}
}
