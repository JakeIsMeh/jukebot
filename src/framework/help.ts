import {
	EmbedBuilder,
	ButtonBuilder,
	ActionRowBuilder,
	ButtonStyle,
	ComponentType,
} from 'discord.js';

import { Pipeline } from './pipeline';
import { defineCommand, InferSchemaTypes } from './types';

const helpOptions = {
	command: { type: 'string', description: 'The specific command to inspect', required: false },
} as const;

const helpPipeline = new Pipeline<{}, InferSchemaTypes<typeof helpOptions>>().run(async (ctx) => {
	const query = ctx.options.command;
	const displayPrefix = ctx.type === 'prefix' ? undefined : '/';
	const activePrefix = displayPrefix ?? ctx.framework.prefix ?? '@Bot ';

	const pages: EmbedBuilder[] = [];

	if (query) {
		const parts = query.trim().split(/ +/);
		const parentQuery = parts[0].toLowerCase();
		const subcommandQuery = parts[1]?.toLowerCase();

		const parentName = ctx.framework.routes.has(parentQuery)
			? parentQuery
			: ctx.framework.aliasMap.get(parentQuery);
		const cmd = parentName ? ctx.framework.routes.get(parentName) : null;

		if (!cmd) {
			const embed = new EmbedBuilder()
				.setDescription(`❌ Command \`${parts[0]}\` not found!`)
				.setColor(0xe74c3c);
			await ctx.reply({ embeds: [embed] });
			return;
		}

		if (subcommandQuery && cmd.subcommands && cmd.subcommands.length > 0) {
			const sub = cmd.subcommands.find(
				(s) =>
					s.name === subcommandQuery ||
					s.aliases?.map((a) => a.toLowerCase()).includes(subcommandQuery),
			);
			if (!sub) {
				const embed = new EmbedBuilder()
					.setDescription(`❌ Subcommand \`${parts[1]}\` not found on command \`${cmd.name}\`!`)
					.setColor(0xe74c3c);
				await ctx.reply({ embeds: [embed] });
				return;
			}

			const optionsList = sub.options ? Object.entries(sub.options) : [];
			if (optionsList.length === 0) {
				const embed = new EmbedBuilder()
					.setTitle(`📘 Subcommand: ${cmd.name} ${sub.name}`)
					.setDescription(sub.description)
					.setColor(0x5865f2);

				if (sub.aliases && sub.aliases.length > 0) {
					embed.addFields({
						name: 'Aliases',
						value: sub.aliases.map((a) => `\`${a}\``).join(', '),
					});
				}

				embed.addFields({
					name: 'Arguments',
					value: '*No options required.*',
				});

				pages.push(embed);
			} else {
				const optionChunkSize = 4;
				const totalPages = Math.ceil(optionsList.length / optionChunkSize);

				for (let i = 0; i < optionsList.length; i += optionChunkSize) {
					const chunk = optionsList.slice(i, i + optionChunkSize);
					const embed = new EmbedBuilder()
						.setTitle(`📘 Subcommand: ${cmd.name} ${sub.name}`)
						.setDescription(sub.description)
						.setColor(0x5865f2);

					if (sub.aliases && sub.aliases.length > 0 && i === 0) {
						embed.addFields({
							name: 'Aliases',
							value: sub.aliases.map((a) => `\`${a}\``).join(', '),
						});
					}

					for (const [optName, rawConfig] of chunk) {
						const opt = rawConfig as any;
						const reqLabel = opt.required ? 'required' : 'optional';
						embed.addFields({
							name: `\`${optName}\` *(${opt.type}, ${reqLabel})*`,
							value: opt.description,
						});
					}

					if (totalPages > 1) {
						embed.setFooter({ text: `Page ${pages.length + 1} of ${totalPages}` });
					}
					pages.push(embed);
				}
			}
		} else {
			const optionsList = cmd.options ? Object.entries(cmd.options) : [];
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
				const embed = new EmbedBuilder()
					.setTitle(`📘 Command: ${cmd.name}`)
					.setDescription(
						`${cmd.description}\n\n*This command has subcommands. Use \`${activePrefix}help ${cmd.name} <subcommand>\` to inspect detailed options.*`,
					)
					.setColor(0x5865f2);

				if (cmd.aliases && cmd.aliases.length > 0) {
					embed.addFields({
						name: 'Aliases',
						value: cmd.aliases.map((a) => `\`${a}\``).join(', '),
					});
				}

				embed.addFields({
					name: 'Available Subcommands',
					value: subList
						.map((s) => {
							const isDefault = s.name === cmd.defaultSubcommand ? ' *(default)*' : '';
							return `• **${s.name}**${isDefault} - ${s.description}`;
						})
						.join('\n'),
				});

				pages.push(embed);
			} else {
				if (optionsList.length === 0) {
					const embed = new EmbedBuilder()
						.setTitle(`📘 Command: ${cmd.name}`)
						.setDescription(cmd.description)
						.setColor(0x5865f2);

					if (cmd.aliases && cmd.aliases.length > 0) {
						embed.addFields({
							name: 'Aliases',
							value: cmd.aliases.map((a) => `\`${a}\``).join(', '),
						});
					}

					embed.addFields({
						name: 'Arguments',
						value: '*No options required.*',
					});

					pages.push(embed);
				} else {
					const optionChunkSize = 4;
					const totalPages = Math.ceil(optionsList.length / optionChunkSize);

					for (let i = 0; i < optionsList.length; i += optionChunkSize) {
						const chunk = optionsList.slice(i, i + optionChunkSize);
						const embed = new EmbedBuilder()
							.setTitle(`📘 Command: ${cmd.name}`)
							.setDescription(cmd.description)
							.setColor(0x5865f2);

						if (cmd.aliases && cmd.aliases.length > 0 && i === 0) {
							embed.addFields({
								name: 'Aliases',
								value: cmd.aliases.map((a) => `\`${a}\``).join(', '),
							});
						}

						for (const [optName, rawConfig] of chunk) {
							const opt = rawConfig as any;
							const reqLabel = opt.required ? 'required' : 'optional';
							embed.addFields({
								name: `\`${optName}\` *(${opt.type}, ${reqLabel})*`,
								value: opt.description,
							});
						}

						if (totalPages > 1) {
							embed.setFooter({ text: `Page ${pages.length + 1} of ${totalPages}` });
						}
						pages.push(embed);
					}
				}
			}
		}
	} else {
		const commands = Array.from(ctx.framework.routes.values());

		if (commands.length === 0) {
			const embed = new EmbedBuilder()
				.setTitle('📖 Help Menu')
				.setDescription('No commands are currently registered.')
				.setColor(0x5865f2);
			await ctx.reply({ embeds: [embed] });
			return;
		}

		const chunkSize = 5;
		const totalPages = Math.ceil(commands.length / chunkSize);

		for (let i = 0; i < commands.length; i += chunkSize) {
			const chunk = commands.slice(i, i + chunkSize);
			const embed = new EmbedBuilder()
				.setTitle('📖 Help Menu')
				.setDescription(
					`Use \`${activePrefix}help <command>\` for detailed option specifications!\n\n` +
						chunk
							.map((cmd) => {
								let aliasesStr = '';
								if (cmd.aliases && cmd.aliases.length > 0) {
									aliasesStr = ` *(Aliases: ${cmd.aliases.map((a) => `\`${a}\``).join(', ')})*`;
								}
								let out = `• **${cmd.name}**${aliasesStr}\n  ${cmd.description}`;

								if (cmd.subcommands && cmd.subcommands.length > 0) {
									const subList = [...cmd.subcommands];
									if (cmd.pipeline && cmd.defaultSubcommand) {
										const hasDefaultSub = cmd.subcommands.some(
											(s) => s.name === cmd.defaultSubcommand,
										);
										if (!hasDefaultSub) {
											subList.unshift({ name: cmd.defaultSubcommand } as any);
										}
									}
									const subnames = subList
										.map((s) => {
											const isDefault =
												s.name === cmd.defaultSubcommand ? `${s.name}*(default)*` : s.name;
											return `\`${isDefault}\``;
										})
										.join(', ');
									out += `\n  ↳ *Subcommands:* ${subnames}`;
								}
								return out;
							})
							.join('\n\n'),
				)
				.setColor(0x5865f2);

			if (totalPages > 1) {
				embed.setFooter({ text: `Page ${pages.length + 1} of ${totalPages}` });
			}
			pages.push(embed);
		}
	}

	const totalPages = pages.length;
	let currentPage = 0;

	const getMessagePayload = (pageIndex: number) => {
		const embed = pages[pageIndex];

		if (totalPages <= 1) {
			return { embeds: [embed], components: [] };
		}

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('help_prev')
				.setLabel('◀️ Previous')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(pageIndex === 0),
			new ButtonBuilder()
				.setCustomId('help_next')
				.setLabel('Next ▶️')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(pageIndex === totalPages - 1),
		);

		return { embeds: [embed], components: [row] };
	};

	const message = await ctx.reply(getMessagePayload(currentPage));

	if (totalPages > 1) {
		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60000,
		});

		collector.on('collect', async (interaction) => {
			if (interaction.user.id !== ctx.author.id) {
				await interaction.reply({
					embeds: [
						{
							description:
								'❌ Only the user who requested this help menu can use the pagination buttons.',
							color: 0xe74c3c,
						},
					],
					ephemeral: true,
				});
				return;
			}

			if (interaction.customId === 'help_prev') {
				currentPage = Math.max(0, currentPage - 1);
			} else if (interaction.customId === 'help_next') {
				currentPage = Math.min(totalPages - 1, currentPage + 1);
			}

			await interaction.update(getMessagePayload(currentPage));
		});

		collector.on('end', async () => {
			const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId('help_prev')
					.setLabel('◀️ Previous')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(true),
				new ButtonBuilder()
					.setCustomId('help_next')
					.setLabel('Next ▶️')
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(true),
			);

			try {
				await message.edit({ components: [disabledRow] });
			} catch {
				// Message might have been deleted
			}
		});
	}
});

export const helpCommand = defineCommand({
	name: 'help',
	description: 'Displays command specs and helper guides',
	aliases: ['h'],
	options: helpOptions,
	pipeline: helpPipeline,
});
