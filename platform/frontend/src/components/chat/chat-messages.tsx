import type { UIMessage } from "@ai-sdk/react";
import type { ChatStatus, DynamicToolUIPart, ToolUIPart } from "ai";
import { Check, Pencil, X } from "lucide-react";
import Image from "next/image";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatMessagesProps {
  messages: UIMessage[];
  hideToolCalls?: boolean;
  status: ChatStatus;
  setMessages?: (messages: UIMessage[]) => void;
  // biome-ignore lint/suspicious/noExplicitAny: Message content is dynamic
  sendMessage?: (message: any) => void;
  reload?: () => Promise<string | null | undefined>;
  isLoadingConversation?: boolean;
}

// Type guards for tool parts
// biome-ignore lint/suspicious/noExplicitAny: AI SDK message parts have dynamic structure
function isToolPart(part: any): part is {
  type: string;
  state?: string;
  toolCallId?: string;
  // biome-ignore lint/suspicious/noExplicitAny: Tool inputs are dynamic based on tool schema
  input?: any;
  // biome-ignore lint/suspicious/noExplicitAny: Tool outputs are dynamic based on tool execution
  output?: any;
  errorText?: string;
} {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part.type?.startsWith("tool-") || part.type === "dynamic-tool")
  );
}

export function ChatMessages({
  messages,
  hideToolCalls = false,
  status,
  setMessages,
  reload,
  isLoadingConversation = false,
}: ChatMessagesProps) {
  const isStreamingStalled = useStreamingStallDetection(messages, status);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleStartEdit = (message: UIMessage, content: string) => {
    setEditingMessageId(message.id);
    setEditedContent(content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditedContent("");
    setIsSaving(false);
  };

  const handleSaveEdit = async (message: UIMessage) => {
    // Check if content matches by looking at parts since UIMessage typing might not expose content directly
    const currentContent = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (!editedContent.trim() || editedContent === currentContent) {
      handleCancelEdit();
      return;
    }

    setIsSaving(true);
    try {
      const isUserMessage = message.role === "user";

      // 1. Call API to update message
      const response = await fetch(`/api/chat/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editedContent,
          deleteSubsequent: isUserMessage, // Cascade delete for user messages
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update message");
      }

      // 2. Update local state
      if (setMessages) {
        if (isUserMessage) {
          // For User messages: Truncate history and Regenerate
          const messageIndex = messages.findIndex((m) => m.id === message.id);
          if (messageIndex !== -1) {
            // Keep messages UP TO the edited message (exclusive)
            // The edited message itself needs to be replaced/re-added with new content
            const keptMessages = messages.slice(0, messageIndex);

            // Update the history directly
            const updatedMessage = {
              ...message,
              content: editedContent,
              parts: message.parts.map((p) =>
                p.type === "text" ? { ...p, text: editedContent } : p,
              ),
            };

            // Set messages to [previous..., updatedMessage]
            // This puts the conversation in the state "User just sent this message"
            setMessages([...keptMessages, updatedMessage]);

            // Trigger regeneration
            if (reload) {
              // reload() will re-send the request based on the current messages.
              // Since the last message is now the User message, it should generate a response.
              await reload();
            }
          }
        } else {
          // For Assistant messages: Just update in place
          const updatedMessages = messages.map((m) => {
            if (m.id === message.id) {
              return {
                ...m,
                content: editedContent,
                parts: m.parts.map((p) =>
                  p.type === "text" ? { ...p, text: editedContent } : p,
                ),
              };
            }
            return m;
          });
          setMessages(updatedMessages as UIMessage[]);
        }
      }

      handleCancelEdit();
    } catch (error) {
      console.error("Failed to edit message:", error);
      setIsSaving(false);
    }
  };

  if (messages.length === 0) {
    // Don't show "start conversation" message while loading - prevents flash of empty state
    if (isLoadingConversation) {
      return null;
    }

    return (
      <div className="flex-1 flex h-full items-center justify-center text-center text-muted-foreground">
        <p className="text-sm">Start a conversation by sending a message</p>
      </div>
    );
  }

  return (
    <Conversation className="h-full">
      <ConversationContent>
        <div className="max-w-4xl mx-auto">
          {messages.map((message, idx) => (
            <div key={message.id || idx}>
              {message.parts.map((part, i) => {
                // Skip tool result parts that immediately follow a tool invocation with same toolCallId
                if (
                  isToolPart(part) &&
                  part.state === "output-available" &&
                  i > 0
                ) {
                  const prevPart = message.parts[i - 1];
                  if (
                    isToolPart(prevPart) &&
                    prevPart.state === "input-available" &&
                    prevPart.toolCallId === part.toolCallId
                  ) {
                    return null;
                  }
                }

                // Hide tool calls if hideToolCalls is true
                if (
                  hideToolCalls &&
                  isToolPart(part) &&
                  (part.type?.startsWith("tool-") ||
                    part.type === "dynamic-tool")
                ) {
                  return null;
                }

                switch (part.type) {
                  case "text": {
                    const isEditing = editingMessageId === message.id;
                    const canEdit =
                      setMessages &&
                      (message.role === "user" || message.role === "assistant");

                    return (
                      <Fragment key={`${message.id}-${i}`}>
                        <Message from={message.role} className="relative group">
                          {/* Edit Button */}
                          {canEdit && !isEditing && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                handleStartEdit(message, part.text)
                              }
                              className="absolute top-2 -right-10 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}

                          <MessageContent
                            className={isEditing ? "w-full max-w-full" : ""}
                          >
                            {message.role === "system" && !isEditing && (
                              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                System Prompt
                              </div>
                            )}

                            {isEditing ? (
                              <div className="flex flex-col gap-2 w-full min-w-[300px]">
                                <Textarea
                                  value={editedContent}
                                  onChange={(e) =>
                                    setEditedContent(e.target.value)
                                  }
                                  className="min-h-[100px] bg-background/50"
                                  placeholder="Edit message..."
                                />
                                <div className="flex gap-2 justify-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCancelEdit}
                                    disabled={isSaving}
                                  >
                                    <X className="h-4 w-4 mr-1" />
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleSaveEdit(message)}
                                    disabled={isSaving}
                                  >
                                    <Check className="h-4 w-4 mr-1" />
                                    Save
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Response>{part.text}</Response>
                            )}
                          </MessageContent>
                        </Message>
                      </Fragment>
                    );
                  }

                  case "reasoning":
                    // ... (same as before)
                    return (
                      <Reasoning key={`${message.id}-${i}`} className="w-full">
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    );

                  case "dynamic-tool": {
                    if (!isToolPart(part)) return null;
                    const toolName = part.toolName;

                    // Look ahead for tool result (same tool call ID)
                    let toolResultPart = null;
                    const nextPart = message.parts[i + 1];
                    if (
                      nextPart &&
                      isToolPart(nextPart) &&
                      nextPart.type === "dynamic-tool" &&
                      nextPart.state === "output-available" &&
                      nextPart.toolCallId === part.toolCallId
                    ) {
                      toolResultPart = nextPart;
                    }

                    return (
                      <MessageTool
                        part={part}
                        key={`${message.id}-${i}`}
                        toolResultPart={toolResultPart}
                        toolName={toolName}
                      />
                    );
                  }

                  default: {
                    // Handle tool invocations (type is "tool-{toolName}")
                    if (isToolPart(part) && part.type?.startsWith("tool-")) {
                      const toolName = part.type.replace("tool-", "");

                      // Look ahead for tool result (same tool call ID)
                      // biome-ignore lint/suspicious/noExplicitAny: Tool result structure varies by tool type
                      let toolResultPart: any = null;
                      const nextPart = message.parts[i + 1];
                      if (
                        nextPart &&
                        isToolPart(nextPart) &&
                        nextPart.type?.startsWith("tool-") &&
                        nextPart.state === "output-available" &&
                        nextPart.toolCallId === part.toolCallId
                      ) {
                        toolResultPart = nextPart;
                      }

                      return (
                        <MessageTool
                          part={part}
                          key={`${message.id}-${i}`}
                          toolResultPart={toolResultPart}
                          toolName={toolName}
                        />
                      );
                    }

                    // Skip step-start and other non-renderable parts
                    return null;
                  }
                }
              })}
            </div>
          ))}
          {(status === "submitted" ||
            (status === "streaming" && isStreamingStalled)) && (
              <Message from="assistant">
                <Image
                  src={"/logo.png"}
                  alt="Loading logo"
                  width={40}
                  height={40}
                  className="object-contain h-8 w-auto animate-[bounce_700ms_ease_200ms_infinite]"
                />
              </Message>
            )}
        </div>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

// Custom hook to detect when streaming has stalled (>500ms without updates)
function useStreamingStallDetection(
  messages: UIMessage[],
  status: ChatStatus,
): boolean {
  const lastUpdateTimeRef = useRef<number>(Date.now());
  const [isStreamingStalled, setIsStreamingStalled] = useState(false);

  // Update last update time when messages change
  // biome-ignore lint/correctness/useExhaustiveDependencies: we need to react to messages change here
  useEffect(() => {
    if (status === "streaming") {
      lastUpdateTimeRef.current = Date.now();
      setIsStreamingStalled(false);
    }
  }, [messages, status]);

  // Check periodically if streaming has stalled
  useEffect(() => {
    if (status !== "streaming") {
      setIsStreamingStalled(false);
      return;
    }

    const interval = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - lastUpdateTimeRef.current;
      if (timeSinceLastUpdate > 1_000) {
        setIsStreamingStalled(true);
      } else {
        setIsStreamingStalled(false);
      }
    }, 100); // Check every 100ms

    return () => clearInterval(interval);
  }, [status]);

  return isStreamingStalled;
}

function MessageTool({
  part,
  toolResultPart,
  toolName,
}: {
  part: ToolUIPart | DynamicToolUIPart;
  toolResultPart: ToolUIPart | DynamicToolUIPart | null;
  toolName: string;
}) {
  const outputError = toolResultPart
    ? tryToExtractErrorFromOutput(toolResultPart.output)
    : tryToExtractErrorFromOutput(part.output);
  const errorText = toolResultPart
    ? (toolResultPart.errorText ?? outputError)
    : (part.errorText ?? outputError);

  const hasInput = part.input && Object.keys(part.input).length > 0;
  const hasContent = Boolean(
    hasInput ||
    (toolResultPart && Boolean(toolResultPart.output)) ||
    (!toolResultPart && Boolean(part.output)),
  );

  return (
    <Tool className={hasContent ? "cursor-pointer" : ""}>
      <ToolHeader
        type={`tool-${toolName}`}
        state={getHeaderState({
          state: part.state || "input-available",
          toolResultPart,
          errorText,
        })}
        errorText={errorText}
        isCollapsible={hasContent}
      />
      <ToolContent>
        {hasInput ? <ToolInput input={part.input} /> : null}
        {toolResultPart && (
          <ToolOutput
            label={errorText ? "Error" : "Result"}
            output={toolResultPart.output}
            errorText={errorText}
          />
        )}
        {!toolResultPart && Boolean(part.output) && (
          <ToolOutput
            label={errorText ? "Error" : "Result"}
            output={part.output}
            errorText={errorText}
          />
        )}
      </ToolContent>
    </Tool>
  );
}

const tryToExtractErrorFromOutput = (output: unknown) => {
  try {
    if (typeof output !== "string") return undefined;
    const json = JSON.parse(output);
    return typeof json.error === "string" ? json.error : undefined;
  } catch (_error) {
    return undefined;
  }
};
const getHeaderState = ({
  state,
  toolResultPart,
  errorText,
}: {
  state: ToolUIPart["state"] | DynamicToolUIPart["state"];
  toolResultPart: ToolUIPart | DynamicToolUIPart | null;
  errorText: string | undefined;
}) => {
  if (errorText) return "output-error";
  if (toolResultPart) return "output-available";
  return state;
};
