import {OpenAI} from "./openai"
import {Cloudflare} from "./cloudflare"
import { InteractionResponseFlags, InteractionResponseType, InteractionType, verifyKey } from "discord-interactions";
import { Discord } from "./discord";
import { DISCORD_COMMANDS } from "./commands";

export interface Env {
	CHATGPT_DISCORD_BOT_KV: KVNamespace
	DISCORD_PUBLIC_KEY: string
	DISCORD_APPLICATION_ID: string
	DISCORD_TOKEN: string
	DISCORD_USERID_WHITELIST: string
	OPENAI_API_KEY: string
	CHATGPT_MODEL: string
	CONTEXT: number
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		// verify request came from Discord
		const signature = request.headers.get('x-signature-ed25519');
		const timestamp = request.headers.get('x-signature-timestamp');
		if (!signature || !timestamp) {
			return Discord.generateResponse({
				error: "Unauthorized"
			}, {
				status: 401,
			})
		}
		const body = await request.clone().arrayBuffer();
		const isValidRequest = verifyKey(
			body,
			signature,
			timestamp,
			env.DISCORD_PUBLIC_KEY
		);
		if (!isValidRequest) {
			return Discord.generateResponse({
				error: "Unauthorized"
			}, {
				status: 401,
			})
		}

		const message: Discord.Interaction = await request.json()

		const chatId: string = message.channel_id || message.user?.id || "-1"

		// user is not in whitelist
		const userId: string = message.member?.user?.id || message.user?.id || "-1"
		if (env.DISCORD_USERID_WHITELIST && !env.DISCORD_USERID_WHITELIST.split(" ").includes(userId)) {
			return Discord.generateResponse({
				error: "Unauthorized"
			}, {
				status: 401,
			})
		}

		if (message.type === InteractionType.PING) {
			return Discord.generateResponse({
				type: InteractionResponseType.PONG,
			})
		}

		if (message.type === InteractionType.APPLICATION_COMMAND) {
			switch (message.data.name.toLowerCase()) {
				case DISCORD_COMMANDS.CHATGPT_COMMAND.name.toLowerCase(): {
					const context = await _getContext(env, chatId)

					// join all arguments
					const query = message.data.options?.map((option) => option.value).join(" ") || ""
					if (query.trim() == "") {
						return Discord.generateResponse({
							type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
							data: {
								content: "Please provide a query",
								flags: InteractionResponseFlags.EPHEMERAL,
							}
						})
					}

					// prepare context
					context.push({"role": "user", "content": query})

					// send response to Discord once ready
					ctx.waitUntil(new Promise(async _ => {
						// query OpenAPI with context
						const response = await OpenAI.complete(env.OPENAI_API_KEY, env.CHATGPT_MODEL, context)
						const json: OpenAI.Response = await response.json()
						const content = json.choices[0].message.content.trim()

						// add reply to context
						if (env.CONTEXT && env.CONTEXT > 0 && env.CHATGPT_DISCORD_BOT_KV) {
							context.push({"role": "assistant", "content": content})
							await Cloudflare.putKVChatContext(env.CHATGPT_DISCORD_BOT_KV, chatId, context)
						}

						await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${message.token}/messages/@original`, {
							method: "PATCH",
							headers: {
								"Content-Type": "application/json;charset=UTF-8",
							},
							body: JSON.stringify({
								content: `> ${query}`,
								embeds: [{description: content}]
							})
						})
					}))

					// immediately respond an acknowledgement first
					return Discord.generateResponse({
						type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					})
				}
				case DISCORD_COMMANDS.CONTEXT_COMMAND.name.toLowerCase(): {
					const context = await _getContext(env, chatId)

					if (context.length > 0) {
						return Discord.generateResponse({
							type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
							data: {
								content: "```json\n"+JSON.stringify(context)+"\n```",
							}
						})
					}
					return Discord.generateResponse({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: "Context is empty or not available.",
							flags: InteractionResponseFlags.EPHEMERAL
						}
					})
				}
				case DISCORD_COMMANDS.CLEAR_COMMAND.name.toLowerCase(): {
					if (env.CONTEXT && env.CONTEXT > 0 && env.CHATGPT_DISCORD_BOT_KV) {
						await Cloudflare.putKVChatContext(env.CHATGPT_DISCORD_BOT_KV, chatId, [])
					}
					return Discord.generateResponse({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: "Context for the current chat (if it existed) has been cleared.",
							flags: InteractionResponseFlags.EPHEMERAL
						}
					})
				}
				case DISCORD_COMMANDS.INVITE_COMMAND.name.toLowerCase(): {
					const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_APPLICATION_ID}&permissions=2147485696&scope=bot`;
					return Discord.generateResponse({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: INVITE_URL,
							flags: InteractionResponseFlags.EPHEMERAL
						}
					})
				}
				default: {
					return Discord.generateResponse({
						error: "Unknown command"
					}, {
						status: 400,
					})
				}
			}
		}

		return Discord.generateResponse({
			error: "Unexpected error"
		}, {
			status: 500,
		})
	}
}

async function _getContext(env: Env, chatId: string): Promise<OpenAI.Message[]> {
	// retrieve current context
	let context: OpenAI.Message[] = []
	if (env.CONTEXT && env.CONTEXT > 0 && env.CHATGPT_DISCORD_BOT_KV) {
		context = await Cloudflare.getKVChatContext(env.CHATGPT_DISCORD_BOT_KV, chatId)
	}
	// truncate context to a maximum of (env.CONTEXT * 2)
	while (context.length > Math.max(1, env.CONTEXT * 2)) {
		context.shift()
	}
	return context
}
