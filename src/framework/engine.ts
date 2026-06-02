import {
	GuildMember,
	MessageFlagsBitField,
	Interaction,
	Message,
	SlashCommandBuilder,
	REST,
	Routes,
	MessageFlags,
	AutocompleteInteraction,
} from 'discord.js';
import { nanoid } from 'nanoid';

import { rootLogger, logStorage, requestLogger } from './logger';
import {
	DataObject,
	Context,
	CommandConfig,
	SubcommandConfig,
	CommandOptionsSchema,
	CommandOption,
	Middleware,
} from './types';

export interface FrameworkOptions {
	prefix?: string;
}

export class Framework<TServices extends Record<string, any> = Record<string, any>> {
	private options: FrameworkOptions;
	public routes = new Map<string, CommandConfig<DataObject, any, TServices>>();
	public aliasMap = new Map<string, string>();
	public globalMiddlewares: Middleware<any, any, TServices>[] = [];
	public services: TServices = {} as TServices;

	constructor(options: FrameworkOptions = {}) {
		this.options = options;
	}

	public use(middleware: Middleware<any, any, TServices>): this {
		this.globalMiddlewares.push(middleware);
		return this;
	}

	public provide<TKey extends string, TValue>(
		key: TKey,
		value: TValue,
	): Framework<TServices & Record<TKey, TValue>> {
		(this.services as any)[key] = value;
		return this as any;
	}

	public get prefix(): string | undefined {
		return this.options.prefix;
	}

	private generateAbbreviatedHelp(
		cmd: CommandConfig<any, any>,
		errors: Array<{
			name: string;
			type: string;
			required: boolean;
			description: string;
			error: string;
		}>,
	): string {
		let spec = `\n\n💡 **Usage: ${cmd.name}**\n`;
		spec += `*The following option(s) are wrong or missing:*\n`;
		for (const err of errors) {
			const reqLabel = err.required ? 'required' : 'optional';
			spec += `• \`${err.name}\` *(${err.type}, ${reqLabel})* - **${err.error}**\n`;
			spec += `  *Description:* ${err.description}\n`;
		}
		return spec;
	}

	public command<
		TData extends DataObject,
		TOptions extends CommandOptionsSchema<TServices> = CommandOptionsSchema<TServices>,
	>(config: CommandConfig<TData, TServices, TOptions>): this {
		this.routes.set(config.name, config as unknown as CommandConfig<DataObject, any, TServices>);
		if (config.aliases) {
			for (const alias of config.aliases) this.aliasMap.set(alias, config.name);
		}
		return this;
	}

	public generateHelp(commandQuery?: string, prefix?: string): string {
		const activePrefix = prefix ?? this.options.prefix ?? '@Bot ';

		if (commandQuery) {
			const query = commandQuery.toLowerCase();
			const commandName = this.routes.has(query) ? query : this.aliasMap.get(query);
			const cmd = commandName ? this.routes.get(commandName) : null;

			if (!cmd) {
				return `❌ Command \`${commandQuery}\` not found!`;
			}

			let help = `📘 **Command: ${cmd.name}**\n${cmd.description}\n\n`;
			if (cmd.aliases && cmd.aliases.length > 0) {
				help += `**Aliases:** ${cmd.aliases.map((a) => `\`${a}\``).join(', ')}\n\n`;
			}

			if (cmd.options && Object.keys(cmd.options).length > 0) {
				help += `**Arguments:**\n`;
				for (const [name, rawConfig] of Object.entries(cmd.options)) {
					const opt = rawConfig as CommandOption;
					const reqLabel = opt.required ? 'required' : 'optional';
					help += `• \`${name}\` *(${opt.type}, ${reqLabel})* - ${opt.description}\n`;
				}
			} else {
				help += `*No options required.*`;
			}

			return help;
		}

		let help = `📖 **Help Menu**\n`;
		help += `Use \`${activePrefix}help <command>\` for detailed option specifications!\n\n`;

		for (const cmd of this.routes.values()) {
			let aliasesStr = '';
			if (cmd.aliases && cmd.aliases.length > 0) {
				aliasesStr = ` (Aliases: ${cmd.aliases.map((a) => `\`${a}\``).join(', ')})`;
			}
			help += `• **${cmd.name}**${aliasesStr} - ${cmd.description}\n`;
		}

		return help;
	}

	public async handleInteraction(interaction: Interaction): Promise<void> {
		if (interaction.isAutocomplete()) {
			const autoInteraction = interaction as AutocompleteInteraction;
			const route = this.routes.get(autoInteraction.commandName);
			if (!route) return;

			const subcommandName = autoInteraction.options.getSubcommand(false);
			let targetOptionsSchema = route.options;

			if (subcommandName) {
				const sub = route.subcommands?.find(
					(s) => s.name === subcommandName || s.aliases?.includes(subcommandName),
				);
				if (subcommandName === route.defaultSubcommand && !sub) {
					targetOptionsSchema = route.options;
				} else if (sub) {
					targetOptionsSchema = sub.options;
				}
			}

			if (!targetOptionsSchema) return;

			const focusedOption = autoInteraction.options.getFocused(true);
			const optionConfig = targetOptionsSchema[focusedOption.name];

			if (optionConfig && optionConfig.autocomplete) {
				const member =
					autoInteraction.member instanceof GuildMember ? autoInteraction.member : null;
				const state = { replied: false };

				const baseCtx: Omit<Context<DataObject, any, TServices>, 'log' | 'options'> = {
					interaction: autoInteraction as any,
					message: null,
					type: 'slash',
					author: autoInteraction.user,
					member,
					channel: autoInteraction.channel,
					framework: this,
					services: this.services,
					get replied() {
						return state.replied;
					},
					reply: async () => {
						throw new Error(
							'❌ Cannot call reply() inside an autocomplete handler. Use interaction.respond() instead.',
						);
					},
					push<TNew extends DataObject>(this: any, newData: TNew) {
						return {
							...this,
							data: { ...this.data, ...newData },
						} as any;
					},
					data: {},
				};

				const fullCtx: Omit<Context<any, any, TServices>, 'options'> = {
					...baseCtx,
					log: requestLogger,
					data: {},
				};

				try {
					const choices = await optionConfig.autocomplete(fullCtx, focusedOption.value);
					await autoInteraction.respond(choices);
				} catch (error) {
					requestLogger.error('❌ Autocomplete Handler Failed', {}, error as Error);
				}
			}
			return;
		}

		if (!interaction.isChatInputCommand()) return;
		const route = this.routes.get(interaction.commandName);
		if (!route) return;

		const member = interaction.member instanceof GuildMember ? interaction.member : null;

		const state = { replied: false };

		const subcommandName = interaction.options.getSubcommand(false);
		let targetOptionsSchema = route.options;
		let selectedSub: SubcommandConfig<any, any, TServices> | undefined = undefined;

		if (subcommandName) {
			const sub = route.subcommands?.find(
				(s) => s.name === subcommandName || s.aliases?.includes(subcommandName),
			);
			if (subcommandName === route.defaultSubcommand && !sub) {
				targetOptionsSchema = route.options;
			} else if (sub) {
				selectedSub = sub;
				targetOptionsSchema = sub.options;
			}
		}

		const parsedOptions: Record<string, any> = {};
		if (targetOptionsSchema) {
			for (const [name, rawConfig] of Object.entries(targetOptionsSchema)) {
				const config = rawConfig as CommandOption;
				if (config.type === 'string') {
					parsedOptions[name] = interaction.options.getString(name, !!config.required) ?? undefined;
				} else if (config.type === 'integer') {
					parsedOptions[name] =
						interaction.options.getInteger(name, !!config.required) ?? undefined;
				} else if (config.type === 'number') {
					parsedOptions[name] = interaction.options.getNumber(name, !!config.required) ?? undefined;
				} else if (config.type === 'boolean') {
					parsedOptions[name] =
						interaction.options.getBoolean(name, !!config.required) ?? undefined;
				}
			}
		}

		const baseCtx: Omit<Context<DataObject, any, TServices>, 'log'> = {
			interaction,
			message: null,
			type: 'slash',
			author: interaction.user,
			member,
			channel: interaction.channel,
			framework: this,
			services: this.services,
			get replied() {
				return state.replied;
			},
			reply: async (payload, options) => {
				state.replied = true;
				const flagBitfield = new MessageFlagsBitField();

				let replyPayload: any = {};
				if (typeof payload === 'string') {
					replyPayload.content = payload;
				} else {
					replyPayload = { ...payload };
				}

				const flagsToUse = options?.flags ?? replyPayload.flags;
				if (flagsToUse) {
					flagBitfield.add(flagsToUse);
				}
				if (flagBitfield.bitfield) {
					replyPayload.flags = flagBitfield.bitfield;
				}

				const ping = options?.ping ?? replyPayload.ping ?? true;
				replyPayload.allowedMentions = { repliedUser: ping };

				let msg: Message;
				if (interaction.replied || interaction.deferred) {
					msg = await interaction.followUp(replyPayload);
				} else {
					const response = await interaction.reply({ ...replyPayload, withResponse: true });
					const fetchedMessage = response.resource?.message;
					if (!fetchedMessage) {
						throw new Error('❌ Failed to retrieve message from interaction response.');
					}
					msg = fetchedMessage;
				}

				return msg;
			},
			push<TNew extends DataObject>(this: Context<any>, newData: TNew) {
				return {
					...this,
					data: { ...this.data, ...newData },
				} as any;
			},
			data: {},
			options: parsedOptions,
		};

		await this.executePipeline(selectedSub ?? route, baseCtx, []);
	}

	public async handleMessage(message: Message, prefix?: string): Promise<void> {
		const activePrefix = prefix ?? this.options.prefix;

		const clientId = message.client.user?.id;
		const mentionPrefix = clientId ? `<@${clientId}>` : '';
		const nicknameMentionPrefix = clientId ? `<@!${clientId}>` : '';

		let prefixUsed = '';
		if (activePrefix) {
			if (message.content.startsWith(activePrefix)) {
				prefixUsed = activePrefix;
			}
		} else if (clientId) {
			if (message.content.startsWith(mentionPrefix)) {
				prefixUsed = mentionPrefix;
			} else if (message.content.startsWith(nicknameMentionPrefix)) {
				prefixUsed = nicknameMentionPrefix;
			}
		}

		if (!prefixUsed || message.author.bot) return;

		const content = message.content.slice(prefixUsed.length).trim();
		if (!content) return;

		const firstSpace = content.indexOf(' ');
		const inputName = (firstSpace === -1 ? content : content.slice(0, firstSpace)).toLowerCase();

		const commandName = this.routes.has(inputName) ? inputName : this.aliasMap.get(inputName);
		if (!commandName || !this.routes.has(commandName)) return;

		const route = this.routes.get(commandName)!;

		const rawArgsString = firstSpace === -1 ? '' : content.slice(firstSpace + 1).trim();
		const args = rawArgsString ? rawArgsString.split(/ +/) : [];

		let targetOptionsSchema = route.options;
		let targetName = route.name;
		let activeArgs = args;
		let selectedSub: SubcommandConfig<any, any, TServices> | undefined = undefined;

		if (route.subcommands && route.subcommands.length > 0) {
			const potentialSubName = args[0]?.toLowerCase();
			const sub = route.subcommands.find(
				(s) =>
					s.name === potentialSubName ||
					s.aliases?.map((a) => a.toLowerCase()).includes(potentialSubName),
			);

			if (sub) {
				selectedSub = sub;
				targetOptionsSchema = sub.options;
				targetName = `${route.name} ${sub.name}`;
				activeArgs = args.slice(1);
			} else if (potentialSubName === route.defaultSubcommand) {
				targetOptionsSchema = route.options;
				targetName = route.name;
				activeArgs = args.slice(1);
			} else {
				if (route.pipeline) {
					targetOptionsSchema = route.options;
					targetName = route.name;
					activeArgs = args;
				} else {
					const subnames = route.subcommands.map((s) => `\`${s.name}\``).join(', ');
					await message.reply({
						embeds: [
							{
								title: '❌ Missing Subcommand',
								description: `Please specify a valid subcommand!\n\n💡 **Usage: ${route.name} \`<subcommand>\`**\n*Available subcommands:* ${subnames}`,
								color: 0xe74c3c,
							},
						],
						allowedMentions: { repliedUser: false },
					});
					return;
				}
			}
		}

		const parsedOptions: Record<string, any> = {};
		if (targetOptionsSchema) {
			const optionEntries = Object.entries(targetOptionsSchema);
			const errors: Array<{
				name: string;
				type: string;
				required: boolean;
				description: string;
				error: string;
			}> = [];

			for (let i = 0; i < optionEntries.length; i++) {
				const [name, rawConfig] = optionEntries[i];
				const config = rawConfig as CommandOption;
				const isLast = i === optionEntries.length - 1;

				let rawValue: string | undefined = activeArgs[i];

				// Last option is greedy string
				if (isLast && config.type === 'string') {
					rawValue = activeArgs.slice(i).join(' ') || undefined;
				}

				if (config.required && rawValue === undefined) {
					errors.push({
						name,
						type: config.type,
						required: !!config.required,
						description: config.description,
						error: 'Missing required option',
					});
					continue;
				}

				if (rawValue !== undefined) {
					if (config.type === 'string') {
						parsedOptions[name] = rawValue;
					} else if (config.type === 'integer') {
						const num = parseInt(rawValue, 10);
						if (isNaN(num)) {
							errors.push({
								name,
								type: config.type,
								required: !!config.required,
								description: config.description,
								error: `Invalid integer (got "${rawValue}")`,
							});
						} else {
							parsedOptions[name] = num;
						}
					} else if (config.type === 'number') {
						const num = parseFloat(rawValue);
						if (isNaN(num)) {
							errors.push({
								name,
								type: config.type,
								required: !!config.required,
								description: config.description,
								error: `Invalid decimal number (got "${rawValue}")`,
							});
						} else {
							parsedOptions[name] = num;
						}
					} else if (config.type === 'boolean') {
						if (rawValue !== 'true' && rawValue !== 'false') {
							errors.push({
								name,
								type: config.type,
								required: !!config.required,
								description: config.description,
								error: `Must be "true" or "false" (got "${rawValue}")`,
							});
						} else {
							parsedOptions[name] = rawValue === 'true';
						}
					}
				}
			}

			if (errors.length > 0) {
				const fakeRouteForHelp = selectedSub
					? { name: targetName, options: targetOptionsSchema }
					: route;
				const usage = this.generateAbbreviatedHelp(fakeRouteForHelp as any, errors);
				await message.reply({
					embeds: [
						{
							title: '❌ Invalid Command Arguments',
							description: usage.trimStart(),
							color: 0xe74c3c,
						},
					],
					allowedMentions: { repliedUser: false },
				});
				return;
			}
		}

		const state = { replied: false };

		const baseCtx: Omit<Context<DataObject, any, TServices>, 'log'> = {
			interaction: null,
			message,
			type: 'prefix',
			author: message.author,
			member: message.member,
			channel: message.channel,
			framework: this,
			services: this.services,
			get replied() {
				return state.replied;
			},
			reply: async (payload, options) => {
				state.replied = true;
				let replyPayload: any = {};
				if (typeof payload === 'string') {
					replyPayload.content = payload;
				} else {
					replyPayload = { ...payload };
				}
				const ping = options?.ping ?? replyPayload.ping ?? false;
				replyPayload.allowedMentions = { repliedUser: ping };
				return message.reply(replyPayload);
			},
			push<TNew extends DataObject>(this: Context<any>, newData: TNew) {
				return {
					...this,
					data: { ...this.data, ...newData },
				} as any;
			},
			data: {},
			options: parsedOptions,
		};

		await this.executePipeline(selectedSub ?? route, baseCtx, activeArgs);
	}

	public async executePipeline(
		route: CommandConfig<DataObject, any, TServices> | SubcommandConfig<DataObject, any, TServices>,
		baseCtx: Omit<Context<DataObject, any, TServices>, 'log'>,
		args: string[],
	): Promise<void> {
		const traceId = nanoid(8);

		const fullCtx: Context<any, any, TServices> = {
			...baseCtx,
			log: requestLogger,
			data: baseCtx.data || {},
		};

		try {
			if (!route.pipeline) {
				throw new Error(`Command "${route.name}" does not have a pipeline defined.`);
			}
			await logStorage.run({ command: route.name, trace_id: traceId }, async () => {
				let index = -1;
				const dispatch = async (
					i: number,
					currentCtx: Context<any, any, TServices>,
				): Promise<void> => {
					if (i <= index) throw new Error('next() called multiple times');
					index = i;

					if (i === this.globalMiddlewares.length) {
						await route.pipeline!.execute(currentCtx, args);
						return;
					}

					const fn = this.globalMiddlewares[i];
					await fn(currentCtx, async (nextCtx) => {
						if (currentCtx.replied) {
							const name = fn.name || 'anonymous';
							throw new Error(
								`🛑 Pipeline Guard Violation: next() was called in global middleware "${name}" after a reply was already sent to Discord.`,
							);
						}
						await dispatch(i + 1, nextCtx);
					});
				};

				await dispatch(0, fullCtx);
			});
		} catch (error) {
			requestLogger.error(`💥 Pipeline Crash`, {}, error as Error);
			if (!fullCtx.replied) {
				await baseCtx.reply(
					{ embeds: [{ description: '❌ An internal error occurred.', color: 0xe74c3c }] },
					{ flags: [MessageFlags.Ephemeral] },
				);
			}
		}
	}

	/**
	 * @param clearOthers If true, and a guildId is provided, it will also
	 * attempt to clear global commands so you don't see duplicates.
	 */
	public async syncCommands(
		token: string,
		clientId: string,
		guildId?: string,
		clearOthers = false,
	) {
		const rest = new REST({ version: '10' }).setToken(token);
		const body = Array.from(this.routes.values()).map((cmd) => {
			const builder = new SlashCommandBuilder().setName(cmd.name).setDescription(cmd.description);

			const subList = cmd.subcommands ? [...cmd.subcommands] : [];
			if (cmd.pipeline && cmd.defaultSubcommand && cmd.subcommands && cmd.subcommands.length > 0) {
				const hasDefaultSub = cmd.subcommands.some((s) => s.name === cmd.defaultSubcommand);
				if (!hasDefaultSub) {
					subList.unshift({
						name: cmd.defaultSubcommand,
						description: cmd.description,
						options: cmd.options,
						pipeline: cmd.pipeline,
					} as any);
				}
			}

			if (subList.length > 0) {
				for (const sub of subList) {
					builder.addSubcommand((subBuilder) => {
						subBuilder.setName(sub.name).setDescription(sub.description);
						if (sub.options) {
							for (const [name, rawConfig] of Object.entries(sub.options)) {
								const config = rawConfig as CommandOption;
								if (config.type === 'string') {
									subBuilder.addStringOption((o) =>
										o
											.setName(name)
											.setDescription(config.description)
											.setRequired(!!config.required)
											.setAutocomplete(!!config.autocomplete),
									);
								} else if (config.type === 'integer') {
									subBuilder.addIntegerOption((o) =>
										o
											.setName(name)
											.setDescription(config.description)
											.setRequired(!!config.required)
											.setAutocomplete(!!config.autocomplete),
									);
								} else if (config.type === 'number') {
									subBuilder.addNumberOption((o) =>
										o
											.setName(name)
											.setDescription(config.description)
											.setRequired(!!config.required)
											.setAutocomplete(!!config.autocomplete),
									);
								} else if (config.type === 'boolean') {
									subBuilder.addBooleanOption((o) =>
										o
											.setName(name)
											.setDescription(config.description)
											.setRequired(!!config.required),
									);
								}
							}
						}
						return subBuilder;
					});
				}
			} else if (cmd.options) {
				for (const [name, rawConfig] of Object.entries(cmd.options)) {
					const config = rawConfig as CommandOption;
					if (config.type === 'string') {
						builder.addStringOption((o) =>
							o
								.setName(name)
								.setDescription(config.description)
								.setRequired(!!config.required)
								.setAutocomplete(!!config.autocomplete),
						);
					} else if (config.type === 'integer') {
						builder.addIntegerOption((o) =>
							o
								.setName(name)
								.setDescription(config.description)
								.setRequired(!!config.required)
								.setAutocomplete(!!config.autocomplete),
						);
					} else if (config.type === 'number') {
						builder.addNumberOption((o) =>
							o
								.setName(name)
								.setDescription(config.description)
								.setRequired(!!config.required)
								.setAutocomplete(!!config.autocomplete),
						);
					} else if (config.type === 'boolean') {
						builder.addBooleanOption((o) =>
							o.setName(name).setDescription(config.description).setRequired(!!config.required),
						);
					}
				}
			}
			return builder.toJSON();
		});

		// Sync the primary target
		const targetRoute = guildId
			? Routes.applicationGuildCommands(clientId, guildId)
			: Routes.applicationCommands(clientId);
		await rest.put(targetRoute, { body });

		// clear global ghosts in dev mode
		if (guildId && clearOthers) {
			rootLogger.info('🧹 Clearing global ghosts...');
			await rest.put(Routes.applicationCommands(clientId), { body: [] });
		}

		return body.length;
	}
}
