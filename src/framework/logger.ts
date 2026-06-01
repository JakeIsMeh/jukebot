import { AsyncLocalStorage } from 'async_hooks';

import { createConsola } from 'consola';

export type LogAttributes = Record<string, unknown>;

export interface Logger {
	debug(message: string, attributes?: LogAttributes): void;
	info(message: string, attributes?: LogAttributes): void;
	warn(message: string, attributes?: LogAttributes): void;
	error(message: string, attributes?: LogAttributes, error?: Error): void;
}

const baseConsola = createConsola({ level: 4 });

export const logStorage = new AsyncLocalStorage<{ command: string; trace_id: string }>();

const commandLoggers = new Map<string, any>();

function getCommandLogger(command: string) {
	let logger = commandLoggers.get(command);
	if (!logger) {
		logger = baseConsola.withTag(command);
		commandLoggers.set(command, logger);
	}
	return logger;
}

export const requestLogger: Logger = {
	debug: (msg, extra) => {
		const store = logStorage.getStore();
		if (store) {
			const instance = getCommandLogger(store.command);
			const payload = extra ? { trace_id: store.trace_id, ...extra } : { trace_id: store.trace_id };
			instance.debug(msg, payload);
		} else {
			if (extra) baseConsola.debug(msg, extra);
			else baseConsola.debug(msg);
		}
	},
	info: (msg, extra) => {
		const store = logStorage.getStore();
		if (store) {
			const instance = getCommandLogger(store.command);
			const payload = extra ? { trace_id: store.trace_id, ...extra } : { trace_id: store.trace_id };
			instance.info(msg, payload);
		} else {
			if (extra) baseConsola.info(msg, extra);
			else baseConsola.info(msg);
		}
	},
	warn: (msg, extra) => {
		const store = logStorage.getStore();
		if (store) {
			const instance = getCommandLogger(store.command);
			const payload = extra ? { trace_id: store.trace_id, ...extra } : { trace_id: store.trace_id };
			instance.warn(msg, payload);
		} else {
			if (extra) baseConsola.warn(msg, extra);
			else baseConsola.warn(msg);
		}
	},
	error: (msg, extra, err) => {
		const store = logStorage.getStore();
		const instance = store ? getCommandLogger(store.command) : baseConsola;
		const trace = store ? { trace_id: store.trace_id } : {};

		const payload = extra ? { ...trace, ...extra } : trace;
		if (Object.keys(payload).length > 0) {
			instance.error(msg, payload);
		} else {
			instance.error(msg);
		}
		if (err) instance.fail(err);
	},
};

export const createConsolaWrapper = (attributes: LogAttributes = {}): Logger => {
	const tag = typeof attributes.command === 'string' ? attributes.command : 'system';
	const instance = baseConsola.withTag(tag).withDefaults(attributes);

	return {
		debug: (msg, extra) => (extra ? instance.debug(msg, extra) : instance.debug(msg)),
		info: (msg, extra) => (extra ? instance.info(msg, extra) : instance.info(msg)),
		warn: (msg, extra) => (extra ? instance.warn(msg, extra) : instance.warn(msg)),
		error: (msg, extra, err) => {
			if (extra && Object.keys(extra).length > 0) {
				instance.error(msg, extra);
			} else {
				instance.error(msg);
			}
			if (err) instance.fail(err);
		},
	};
};

export const rootLogger = createConsolaWrapper();
