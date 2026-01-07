import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError, constructResponseSchema, UuidIdSchema, ZAi } from "@/types";
import { zAiAdapterFactory } from "./adapterV2/z-ai";
import { handleLLMProxy } from "./llm-proxy-handler";

const zAiProxyRoutes: FastifyPluginAsyncZod = async (fastify) => {
  /**
   * Chat completions (v2)
   * POST /v1/z-ai/chat/completions
   */
  fastify.post(
    "/chat/completions",
    {
      schema: {
        body: ZAi.API.ChatCompletionRequestSchema,
        response: constructResponseSchema(ZAi.API.ChatCompletionResponseSchema),
      },
    },
    async (request, reply) => {
      const organizationId = request.organizationId;
      if (!organizationId) {
        throw new ApiError(401, "Organization not found in request context");
      }

      const externalAgentId = request.headers["x-archestra-agent-id"] as
        | string
        | undefined;
      const userId = request.headers["x-archestra-user-id"] as
        | string
        | undefined;

      return handleLLMProxy(
        request.body,
        request.headers as ZAi.Types.ChatCompletionsHeaders,
        reply,
        zAiAdapterFactory,
        {
          organizationId,
          externalAgentId,
          userId,
        },
      );
    },
  );

  /**
   * Chat completions with explicit agentId (v2)
   * POST /v1/z-ai/:agentId/chat/completions
   */
  fastify.post(
    "/:agentId/chat/completions",
    {
      schema: {
        params: z.object({
          agentId: UuidIdSchema,
        }),
        body: ZAi.API.ChatCompletionRequestSchema,
        response: constructResponseSchema(ZAi.API.ChatCompletionResponseSchema),
      },
    },
    async (request, reply) => {
      const organizationId = request.organizationId;
      if (!organizationId) {
        throw new ApiError(401, "Organization not found in request context");
      }

      const { agentId } = request.params as { agentId: string };
      const externalAgentId = request.headers["x-archestra-agent-id"] as
        | string
        | undefined;
      const userId = request.headers["x-archestra-user-id"] as
        | string
        | undefined;

      return handleLLMProxy(
        request.body,
        request.headers as ZAi.Types.ChatCompletionsHeaders,
        reply,
        zAiAdapterFactory,
        {
          agentId,
          organizationId,
          externalAgentId,
          userId,
        },
      );
    },
  );
};

export default zAiProxyRoutes;
