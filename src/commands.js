
export const DISCORD_COMMANDS = {
    CHATGPT_COMMAND: {
        name: 'chatgpt',
        description: 'Converse with ChatGPT',
        options: [
            {
                type: 3,
                name: 'query',
                description: 'What to say to ChatGPT',
                required: true,
            }
        ],
    },
    CONTEXT_COMMAND: {
        name: 'context',
        description: 'Shows stored context for the current chat',
    },
    CLEAR_COMMAND: {
        name: 'clear',
        description: 'Clears the stored context for the current chat',
    },
    INVITE_COMMAND: {
        name: 'invite',
        description: 'Get an invite link to add the bot to your server',
    },
}
