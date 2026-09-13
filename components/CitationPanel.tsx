"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Globe,
  Quote,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types";

/**
 * Collapsible citation panel: shows the exact document sources and chunk
 * excerpts used for an answer. Collapsed by default showing just badges.
 */

interface CitationPanelProps {
  citations: Citation[];
  /** False when the answer was NOT grounded (fallback path) */
  usedContext: boolean;
  defaultOpen?: boolean;
}

export function CitationPanel({
  citations,
  usedContext,
  defaultOpen = false,
}: CitationPanelProps) {
  return null;
}