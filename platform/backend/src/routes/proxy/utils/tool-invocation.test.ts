import { describe, expect, test } from "@/test";

describe("evaluatePolicies", () => {
    describe("tool arguments serialization (#1411)", () => {
        test("refusal message contains properly serialized JSON, not [object Object]", async ({
            makeAgent,
            makeTool,
            makeAgentTool,
        }) => {
            // Dynamic import to ensure test setup runs first
            const toolInvocation = await import("./tool-invocation");

            // Setup: Create agent with a tool that will be blocked due to untrusted context
            const agent = await makeAgent();
            const tool = await makeTool({ agentId: agent.id, name: "test-tool" });
            await makeAgentTool(agent.id, tool.id, {
                allowUsageWhenUntrustedDataIsPresent: false,
            });

            // Complex nested object that would display as "[object Object]" if not stringified
            const toolArgs = {
                nested: { key: "value" },
                array: [1, 2, 3],
                string: "hello",
            };

            // Call evaluatePolicies - args MUST be a string (JSON.stringify'd)
            const result = await toolInvocation.evaluatePolicies(
                [
                    {
                        toolCallName: "test-tool",
                        toolCallArgs: JSON.stringify(toolArgs),
                    },
                ],
                agent.id,
                false, // untrusted context triggers blocking
            );

            // Verify we get a refusal (tool blocked due to untrusted context)
            expect(result).not.toBeNull();

            if (result) {
                const [refusalMessage, contentMessage] = result;

                // THE CRITICAL ASSERTION: "[object Object]" should NEVER appear
                expect(contentMessage).not.toContain("[object Object]");
                expect(refusalMessage).not.toContain("[object Object]");

                // Verify the actual JSON content IS present
                expect(contentMessage).toContain('"nested"');
                expect(contentMessage).toContain('"key"');
                expect(contentMessage).toContain('"value"');
            }
        });

        test("handles already-stringified JSON arguments correctly", async ({
            makeAgent,
            makeTool,
            makeAgentTool,
        }) => {
            const toolInvocation = await import("./tool-invocation");

            const agent = await makeAgent();
            const tool = await makeTool({ agentId: agent.id, name: "file-reader" });
            await makeAgentTool(agent.id, tool.id, {
                allowUsageWhenUntrustedDataIsPresent: false,
            });

            // Simulate OpenAI function call - arguments already a JSON string
            const argsString = '{"path": "/etc/passwd", "mode": "read"}';

            const result = await toolInvocation.evaluatePolicies(
                [{ toolCallName: "file-reader", toolCallArgs: argsString }],
                agent.id,
                false,
            );

            expect(result).not.toBeNull();

            if (result) {
                const [, contentMessage] = result;

                expect(contentMessage).not.toContain("[object Object]");
                expect(contentMessage).toContain("/etc/passwd");
                expect(contentMessage).toContain("read");
            }
        });
    });
});
