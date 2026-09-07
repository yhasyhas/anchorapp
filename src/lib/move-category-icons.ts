import { Trees, Armchair, Mail, Headphones, Palette, BedDouble } from "lucide-react"
import type { AppIconSource } from "@/components/icons/app-icon"

// Centralizes the 6 move-suggestion category icons — previously duplicated
// as identical emoji maps across move.tsx, move-picker-sheet.tsx and
// move-of-the-day-card.tsx (see CARTOGRAPHIE.md). Keys match
// MoveSuggestion["category"] (src/types/index.ts).
export const moveCategoryIcons: Record<string, AppIconSource> = {
  physical: Trees,
  novelty: Armchair,
  social: Mail,
  mindful: Headphones,
  creative: Palette,
  rest: BedDouble,
}

export const DEFAULT_MOVE_CATEGORY_ICON: AppIconSource = Trees
