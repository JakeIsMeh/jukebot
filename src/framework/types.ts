import {
	ChatInputCommandInteraction,
	Message,
	User,
	GuildMember,
	TextBasedChannel,
	MessageFlags,
	APIEmbed,
	JSONEncodable,
} from 'discord.js';

import { Framework } from './engine';
import { Logger } from './logger';

export type DataObject = Record<string, unknown>;

export interface ReplyOptions {
	flags?: (typeof MessageFlags)[keyof typeof MessageFlags][];
	ping?: boolean;
}

export type ReplyPayload =
	| string
	| {
			content?: string;
			// AUDIT: By typing embeds as a union of 'APIEmbed' and 'JSONEncodable<APIEmbed>' (which EmbedBuilder implements),
			// developers get stunning, instant IDE autocomplete and type safety when writing embeds inline or passing builders.
			embeds?: (APIEmbed | JSONEncodable<APIEmbed>)[];
			// AUDIT: Components are kept as 'any[]' because the underlying Discord.js typings for builders and action rows
			// are highly complex, volatile across minor versions, and best validated at runtime to preserve portability.
			components?: any[];
			flags?: (typeof MessageFlags)[keyof typeof MessageFlags][];
			ping?: boolean;
	  };

export type OptionType = 'string' | 'integer' | 'boolean' | 'number';

export type AutocompleteCallback<TServices extends Record<string, any> = Record<string, any>> = (
	ctx: Omit<Context<any, any, TServices>, 'options'>,
	focusedValue: string | number,
) =>
	| Promise<{ name: string; value: string | number }[]>
	| { name: string; value: string | number }[];

export interface CommandOption<TServices extends Record<string, any> = Record<string, any>> {
	type: OptionType;
	description: string;
	required?: boolean;
	autocomplete?: AutocompleteCallback<TServices>;
}

export type CommandOptionsSchema<TServices extends Record<string, any> = Record<string, any>> =
	Record<string, CommandOption<TServices>>;

export type InferOptionType<T extends CommandOption> = T['type'] extends 'string'
	? string
	: T['type'] extends 'integer'
		? number
		: T['type'] extends 'number'
			? number
			: T['type'] extends 'boolean'
				? boolean
				: never;

export type InferSchemaTypes<T extends CommandOptionsSchema> = {
	[K in keyof T]: T[K]['required'] extends true
		? InferOptionType<T[K]>
		: InferOptionType<T[K]> | undefined;
};

export interface Context<
	TData extends DataObject = DataObject,
	// AUDIT: 'Record<string, any>' is used here rather than 'Record<string, unknown>'
	// to allow direct, autocomplete-friendly dot-property access (e.g. ctx.options.query)
	// without forcing the developer to write manual typecasts or type-guards on every lookup.
	TOptions extends Record<string, any> = Record<string, any>,
	// AUDIT: 'Record<string, any>' is used here to allow dynamic service lookup properties
	// (e.g. ctx.services.db) to be inferred directly as their typed singletons.
	TServices extends Record<string, any> = Record<string, any>,
> {
	interaction: ChatInputCommandInteraction | null;
	message: Message | null;
	type: 'slash' | 'prefix';
	author: User;
	member: GuildMember | null;
	channel: TextBasedChannel | null;
	reply: (payload: ReplyPayload, options?: ReplyOptions) => Promise<Message>;
	data: TData;
	log: Logger;
	push: <TNew extends DataObject>(newData: TNew) => Context<TData & TNew, TOptions, TServices>;
	readonly replied: boolean;
	options: TOptions;
	framework: Framework<TServices>;
	services: TServices;
}

export type Middleware<
	TIn extends DataObject,
	TOut extends DataObject,
	// AUDIT: 'Record<string, any>' allows base generic service constraints for dynamic inference.
	TServices extends Record<string, any> = Record<string, any>,
> = (
	// AUDIT: 'any' is used for the options generic here to decouple middlewares from command-specific
	// options. This allows a single middleware to be reusable across entirely different commands.
	ctx: Context<TIn, any, TServices>,
	next: (ctx: Context<TIn & TOut, any, TServices>) => Promise<void>,
) => Promise<void>;

export interface SubcommandConfig<
	_TData extends DataObject = DataObject,
	// AUDIT: 'Record<string, any>' allows base generic service constraints for dynamic inference.
	TServices extends Record<string, any> = Record<string, any>,
	TOptions extends CommandOptionsSchema<TServices> = CommandOptionsSchema<TServices>,
> {
	name: string;
	description: string;
	aliases?: string[];
	options?: TOptions;
	pipeline: {
		// AUDIT: 'Context<any, any, TServices>' is utilized here as the base executor signature because
		// the centralized engine dispatcher executes subcommand pipelines of different state shapes and option schemas generically.
		execute: (ctx: Context<any, any, TServices>, args: string[]) => Promise<void>;
	};
}

export interface CommandConfig<
	_TData extends DataObject = DataObject,
	// AUDIT: 'Record<string, any>' allows base generic service constraints for dynamic inference.
	TServices extends Record<string, any> = Record<string, any>,
	TOptions extends CommandOptionsSchema<TServices> = CommandOptionsSchema<TServices>,
> {
	name: string;
	description: string;
	aliases?: string[];
	options?: TOptions;
	subcommands?: SubcommandConfig<any, TServices, any>[];
	defaultSubcommand?: string;
	pipeline?: {
		// AUDIT: 'Context<any, any, TServices>' is utilized here as the base executor signature because
		// the centralized engine dispatcher executes command pipelines of different state shapes and option schemas generically.
		execute: (ctx: Context<any, any, TServices>, args: string[]) => Promise<void>;
	};
}

export function defineSubcommand<
	TData extends DataObject = DataObject,
	// AUDIT: 'Record<string, any>' allows base generic service constraints for dynamic inference.
	TServices extends Record<string, any> = Record<string, any>,
	TOptions extends CommandOptionsSchema<TServices> = CommandOptionsSchema<TServices>,
>(
	config: SubcommandConfig<TData, TServices, TOptions>,
): SubcommandConfig<TData, TServices, TOptions> {
	return config;
}

export function defineCommand<
	TData extends DataObject = DataObject,
	// AUDIT: 'Record<string, any>' allows base generic service constraints for dynamic inference.
	TServices extends Record<string, any> = Record<string, any>,
	TOptions extends CommandOptionsSchema<TServices> = CommandOptionsSchema<TServices>,
>(config: CommandConfig<TData, TServices, TOptions>): CommandConfig<TData, TServices, TOptions> {
	return config;
}

export function defineMiddleware<
	TIn extends DataObject = DataObject,
	TOut extends DataObject = DataObject,
	// AUDIT: 'Record<string, any>' allows base generic service constraints for dynamic inference.
	TServices extends Record<string, any> = Record<string, any>,
>(middleware: Middleware<TIn, TOut, TServices>): Middleware<TIn, TOut, TServices> {
	return middleware;
}
