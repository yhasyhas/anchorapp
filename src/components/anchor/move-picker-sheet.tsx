import { useTranslation } from "react-i18next"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Star } from "lucide-react"
import type { MoveSuggestion } from "@/types"

const categoryIcons: Record<string, string> = {
  physical: "\u{1F333}",
  novelty: "\u{1FA91}",
  social: "\u{1F48C}",
  mindful: "\u{1F3A7}",
  creative: "\u{1F3A8}",
  rest: "\u{1F6CC}",
}

interface MovePickerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorLabel: string
  suggestions: MoveSuggestion[]
  onPick: (title: string) => void
}

// Point 2: a lightweight bottom sheet opened from a planning anchor card's
// 💡 button, listing Move-coach suggestions already filtered to that card's
// anchor_category and deduped against whatever's already sitting in the
// OTHER 2 anchors today (see src/lib/move-selection.ts's filterByAnchorCategory
// / excludeUsedTitles, applied by the caller before this list ever reaches
// here — this component is purely presentational, same split as
// MoveOfTheDayCard). 1 tap fills the field; still editable afterwards.
export function MovePickerSheet({ open, onOpenChange, anchorLabel, suggestions, onPick }: MovePickerSheetProps) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="font-heading">{t("move.picker_title", { anchor: anchorLabel })}</SheetTitle>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-6">
          {suggestions.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("move.picker_empty")}</p>
          )}
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              onClick={() => {
                onPick(suggestion.title)
                onOpenChange(false)
              }}
              className="flex w-full items-center gap-3 rounded-xl bg-muted/50 px-4 py-3 text-left transition-colors hover:bg-accent"
            >
              <span className="text-lg">{categoryIcons[suggestion.category] ?? "\u{1F333}"}</span>
              <span className="flex-1 text-sm font-medium text-foreground">{suggestion.title}</span>
              {suggestion.is_favorite && <Star className="h-4 w-4 shrink-0 text-primary" fill="currentColor" />}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
