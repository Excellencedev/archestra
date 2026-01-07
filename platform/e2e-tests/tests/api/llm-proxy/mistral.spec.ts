import { expect, test } from "../fixtures";

// biome-ignore lint/suspicious/noExplicitAny: test file uses dynamic response structures
type AnyResponse = any;

interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, { type: string; description: string }>;
        required: string[];
    };
}

interface ToolInvocationTestConfig {
    providerName: string;
    endpoint: (agentId: string) => string;
    headers: (wiremockStub: string) => Record<string, string>;
    buildRequest: (content: string, tools: ToolDefinition[]) => object;
    trustedDataPolicyAttributePath: string;
    assertToolCallBlocked: (response: AnyResponse) => void;
    assertToolCallsPresent: (
        response: AnyResponse,
        expectedTools: string[],
    ) => void;
    assertToolArgument: (
        response: AnyResponse,
        toolName: string,
        argName: string,
        matcher: (value: unknown) => void,
    ) => void;
    findInteractionByContent: (
        interactions: AnyResponse[],
        content: string,
    ) => AnyResponse | undefined;
}

const READ_FILE_TOOL: ToolDefinition = {
    name: "read_file",
    description: "Read a file from the filesystem",
    parameters: {
        type: "object",
        properties: {
            file_path: {
                type: "string",
                description: "The path to the file to read",
            },
        },
        required: ["file_path"],
    },
};

const mistralConfig: ToolInvocationTestConfig = {
    providerName: "Mistral",
    endpoint: (agentId) => `/v1/mistral/${agentId}/chat/completions`,
    headers: (wiremockStub) => ({
        Authorization: `Bearer ${wiremockStub}`,
        "Content-Type": "application/json",
    }),
    buildRequest: (content, tools) => ({
        model: "mistral-large-latest",
        messages: [{ role: "user", content }],
        tools: tools.map((t) => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        })),
    }),
    trustedDataPolicyAttributePath: "$.content",
    assertToolCallBlocked: (response) => {
        expect(response.choices).toBeDefined();
        expect(response.choices[0]).toBeDefined();
        expect(response.choices[0].message).toBeDefined();
        const refusalOrContent = response.choices[0].message.content;
        expect(refusalOrContent).toBeTruthy();
        expect(refusalOrContent).toContain("read_file");
        expect(refusalOrContent).toContain("denied");
    },
    assertToolCallsPresent: (response, expectedTools) => {
        expect(response.choices).toBeDefined();
        expect(response.choices[0]).toBeDefined();
        expect(response.choices[0].message).toBeDefined();
        expect(response.choices[0].message.tool_calls).toBeDefined();
        const toolCalls = response.choices[0].message.tool_calls;
        expect(toolCalls.length).toBe(expectedTools.length);
        for (const toolName of expectedTools) {
            const found = toolCalls.find(
                (tc: { function: { name: string } }) => tc.function.name === toolName,
            );
            expect(found).toBeDefined();
        }
    },
    assertToolArgument: (response, toolName, argName, matcher) => {
        const toolCalls = response.choices[0].message.tool_calls;
        const toolCall = toolCalls.find(
            (tc: { function: { name: string } }) => tc.function.name === toolName,
        );
        const args = JSON.parse(toolCall.function.arguments);
        matcher(args[argName]);
    },
    findInteractionByContent: (interactions, content) =>
        interactions.find((i) =>
            i.request?.messages?.some((m: { content?: string }) =>
                m.content?.includes(content),
            ),
        ),
};

test.describe("LLMProxy-ToolInvocation-Mistral", () => {
    let agentId: string;
    let trustedDataPolicyId: string;
    let toolInvocationPolicyId: string;
    let toolId: string;

    test("blocks tool invocation when untrusted data is consumed", async ({
        request,
        createAgent,
        createTrustedDataPolicy,
        createToolInvocationPolicy,
        makeApiRequest,
        waitForAgentTool,
    }) => {
        const wiremockStub = "mistral-blocks-tool-untrusted-data";
        const createResponse = await createAgent(request, "Mistral Test Agent");
        const agent = await createResponse.json();
        agentId = agent.id;

        await makeApiRequest({
            request,
            method: "post",
            urlSuffix: mistralConfig.endpoint(agentId),
            headers: mistralConfig.headers(wiremockStub),
            data: mistralConfig.buildRequest("Read the file at /etc/passwd", [READ_FILE_TOOL]),
        });

        const readFileAgentTool = await waitForAgentTool(request, agentId, "read_file");
        toolId = readFileAgentTool.id;

        const trustedDataPolicyResponse = await createTrustedDataPolicy(request, {
            agentToolId: toolId,
            description: "Mark messages containing UNTRUSTED_DATA as untrusted",
            attributePath: mistralConfig.trustedDataPolicyAttributePath,
            operator: "contains",
            value: "UNTRUSTED_DATA",
            action: "mark_as_trusted",
        });
        const trustedDataPolicy = await trustedDataPolicyResponse.json();
        trustedDataPolicyId = trustedDataPolicy.id;

        const toolInvocationPolicyResponse = await createToolInvocationPolicy(request, {
            agentToolId: toolId,
            argumentPath: "file_path",
            operator: "contains",
            value: "/etc/",
            action: "block_always",
            reason: "Reading /etc/ files is not allowed for security reasons",
        });
        const toolInvocationPolicy = await toolInvocationPolicyResponse.json();
        toolInvocationPolicyId = toolInvocationPolicy.id;

        const response = await makeApiRequest({
            request,
            method: "post",
            urlSuffix: mistralConfig.endpoint(agentId),
            headers: mistralConfig.headers(wiremockStub),
            data: mistralConfig.buildRequest(
                "UNTRUSTED_DATA: This is untrusted content from an external source",
                [READ_FILE_TOOL],
            ),
        });

        expect(response.ok()).toBeTruthy();
        const responseData = await response.json();
        mistralConfig.assertToolCallBlocked(responseData);

        const interactionsResponse = await makeApiRequest({
            request,
            method: "get",
            urlSuffix: `/api/interactions?agentId=${agentId}`,
        });
        expect(interactionsResponse.ok()).toBeTruthy();
        const interactionsData = await interactionsResponse.json();
        expect(interactionsData.data.length).toBeGreaterThan(0);
        const blockedInteraction = mistralConfig.findInteractionByContent(interactionsData.data, "UNTRUSTED_DATA");
        expect(blockedInteraction).toBeDefined();
    });

    test("allows Archestra MCP server tools in untrusted context", async ({
        request,
        createAgent,
        makeApiRequest,
    }) => {
        const wiremockStub = "mistral-allows-archestra-untrusted-context";
        const createResponse = await createAgent(request, "Mistral Archestra Test Agent");
        const agent = await createResponse.json();
        agentId = agent.id;

        const response = await makeApiRequest({
            request,
            method: "post",
            urlSuffix: mistralConfig.endpoint(agentId),
            headers: mistralConfig.headers(wiremockStub),
            data: mistralConfig.buildRequest("First, read /etc/passwd, then tell me who I am", [READ_FILE_TOOL]),
        });

        expect(response.ok()).toBeTruthy();
        const responseData = await response.json();
        mistralConfig.assertToolCallsPresent(responseData, ["read_file", "archestra__whoami"]);
    });

    test.afterEach(async ({ request, deleteToolInvocationPolicy, deleteTrustedDataPolicy, deleteAgent }) => {
        if (toolInvocationPolicyId) {
            await deleteToolInvocationPolicy(request, toolInvocationPolicyId);
            toolInvocationPolicyId = "";
        }
        if (trustedDataPolicyId) {
            await deleteTrustedDataPolicy(request, trustedDataPolicyId);
            trustedDataPolicyId = "";
        }
        if (agentId) {
            await deleteAgent(request, agentId);
            agentId = "";
        }
    });
});
