"use client";

import {
  BrainCircuitIcon,
  EyeIcon,
  ImageIcon,
  WrenchIcon,
} from "lucide-react";
import type React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type CapabilityType =
  | "vision"
  | "function_calling"
  | "reasoning"
  | "image_generation";

interface CapabilityConfig {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}

const CAPABILITY_CONFIGS: Record<CapabilityType, CapabilityConfig> = {
  vision: {
    icon: EyeIcon,
    label: "Vision",
    description: "Can analyze and understand images",
  },
  function_calling: {
    icon: WrenchIcon,
    label: "Function Calling",
    description: "Supports tool use and function calling",
  },
  reasoning: {
    icon: BrainCircuitIcon,
    label: "Reasoning",
    description: "Advanced reasoning capabilities",
  },
  image_generation: {
    icon: ImageIcon,
    label: "Image Generation",
    description: "Can generate images",
  },
};

/**
 * Map OpenRouter capability strings to our capability types
 * Handles various naming conventions from OpenRouter
 */
export function mapCapability(capability: string): CapabilityType | null {
  const capLower = capability.toLowerCase();

  // Vision capability
  if (capLower === "vision" || capLower === "image") {
    return "vision";
  }

  // Function calling capability
  if (
    capLower === "function_calling" ||
    capLower === "tools" ||
    capLower === "functions"
  ) {
    return "function_calling";
  }

  // Reasoning capability
  if (capLower === "reasoning") {
    return "reasoning";
  }

  // Image generation capability
  if (capLower === "image_generation" || capLower === "image_gen") {
    return "image_generation";
  }

  // Unknown capability
  return null;
}

interface ModelCapabilityIconsProps {
  capabilities: string[];
  className?: string;
}

/**
 * Displays capability icons for a model
 * Each icon has a tooltip explaining the capability
 */
export function ModelCapabilityIcons({
  capabilities,
  className,
}: ModelCapabilityIconsProps) {
  if (!capabilities || capabilities.length === 0) {
    return null;
  }

  // Map capabilities to known types and filter out unknowns
  const mappedCapabilities = capabilities
    .map(mapCapability)
    .filter((cap): cap is CapabilityType => cap !== null);

  // Remove duplicates
  const uniqueCapabilities = Array.from(new Set(mappedCapabilities));

  if (uniqueCapabilities.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {uniqueCapabilities.map((capabilityType) => {
        const config = CAPABILITY_CONFIGS[capabilityType];
        const Icon = config.icon;

        return (
          <Tooltip key={capabilityType}>
            <TooltipTrigger asChild>
              <div
                className="flex items-center justify-center"
                aria-label={config.description}
              >
                <Icon className="size-4 text-muted-foreground" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="font-medium">{config.label}</p>
              <p className="text-xs text-muted-foreground">
                {config.description}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
