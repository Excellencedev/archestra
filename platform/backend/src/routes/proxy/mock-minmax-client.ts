/**
 * Mock MiniMax Client for Benchmarking
 *
 * Returns immediate tool call responses without making actual API calls.
 * Used for benchmarking Archestra platform overhead without network latency.
 */

import type OpenAI from "openai";

/**
 * Options for controlling mock stream behavior
 */
export interface MockStreamOptions {
    /** If set, the stream will end early at this chunk index (0-based) */
    interruptAtChunk?: number;
}

const MOCK_RESPONSE: OpenAI.Chat.Completions.ChatCompletion = {
    id: "chatcmpl-minimax-mock-123",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "abab6.5s-chat",
    choices: [
        {
            index: 0,
            message: {
                role: "assistant",
                content: null,
                refusal: null,
                tool_calls: [
                    {
                        id: "call_minimax_mock_789",
                        type: "function",
                        function: {
                            name: "list_files",
                            arguments: '{"path": "."}',
                        },
                    },
                ],
            },
            finish_reason: "tool_calls",
            logprobs: null,
        },
    ],
    usage: {
        prompt_tokens: 82,
        completion_tokens: 17,
        total_tokens: 99,
    },
};

const MOCK_STREAMING_CHUNKS: OpenAI.Chat.Completions.ChatCompletionChunk[] = [
    {
        id: "chatcmpl-minimax-mock-123",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "abab6.5s-chat",
        choices: [
            {
                index: 0,
                delta: { role: "assistant", content: "" },
                finish_reason: null,
                logprobs: null,
            },
        ],
    },
    {
        id: "chatcmpl-minimax-mock-123",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "abab6.5s-chat",
        choices: [
            {
                index: 0,
                delta: { content: "How can" },
                finish_reason: null,
                logprobs: null,
            },
        ],
    },
    {
        id: "chatcmpl-minimax-mock-123",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "abab6.5s-chat",
        choices: [
            {
                index: 0,
                delta: { content: " I help you?" },
                finish_reason: null,
                logprobs: null,
            },
        ],
    },
    {
        id: "chatcmpl-minimax-mock-123",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "abab6.5s-chat",
        choices: [
            {
                index: 0,
                delta: {},
                finish_reason: "stop",
                logprobs: null,
            },
        ],
        usage: {
            prompt_tokens: 12,
            completion_tokens: 10,
            total_tokens: 22,
        },
    },
];

/**
 * Mock MiniMax Client that returns immediate tool call responses
 */
export class MockMinimaxClient {
    private static streamOptions: MockStreamOptions = {};

    /**
     * Configure stream behavior for testing (static method affects all instances)
     */
    static setStreamOptions(options: MockStreamOptions) {
        MockMinimaxClient.streamOptions = options;
    }

    /**
     * Reset stream options to default
     */
    static resetStreamOptions() {
        MockMinimaxClient.streamOptions = {};
    }

    chat = {
        completions: {
            create: async (
                params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
            ) => {
                // Mock response in chat streaming mode
                if (params.stream) {
                    return {
                        [Symbol.asyncIterator]() {
                            let index = 0;
                            return {
                                async next() {
                                    // Check if we should interrupt at this chunk
                                    if (
                                        MockMinimaxClient.streamOptions.interruptAtChunk !==
                                        undefined &&
                                        index === MockMinimaxClient.streamOptions.interruptAtChunk
                                    ) {
                                        return { done: true, value: undefined };
                                    }

                                    if (index < MOCK_STREAMING_CHUNKS.length) {
                                        return {
                                            value: MOCK_STREAMING_CHUNKS[index++],
                                            done: false,
                                        };
                                    }
                                    return { done: true, value: undefined };
                                },
                            };
                        },
                    };
                    // Mock response in regular mode
                } else {
                    return MOCK_RESPONSE;
                }
            },
        },
    };
}
