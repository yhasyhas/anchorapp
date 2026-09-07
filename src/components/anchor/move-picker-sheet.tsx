import { useTranslation } from "react-i18next"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Star } from "lucide-react"
import { AppIcon } from "@/components/icons/app-icon"
import { moveCategoryIcons, DEFAULT_MOVE_CATEGORY_ICON } from "@/lib/move-category-icons"
import type { MoveSuggestion } from "@/types"

interface MovePickerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Forwarded straight to SheetContent — see use-dialog-focus-restore.ts
  // for why the caller needs this exact hook rather than restoring focus
  // itself from onOpenChange.
  onCloseAutoFocus?: (event: Event) => void
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
export function MovePickerSheet({ open, onOpenChange, onCloseAutoFocus, anchorLabel, suggestions, onPick }: MovePickerSheetProps) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[70vh] overflow-y-auto rounded-t-anchor-card-lg"
        onCloseAutoFocus={onCloseAutoFocus}
      >
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
              className="flex min-h-11 w-full items-center gap-3 rounded-anchor-input bg-muted/50 px-4 py-3 text-left transition-colors hover:bg-accent"
            >
              <AppIcon icon={moveCategoryIcons[suggestion.category] ?? DEFAULT_MOVE_CATEGORY_ICON} size={20} decorative className="text-primary" />
              <span className="flex-1 text-sm font-medium text-foreground">{suggestion.title}</span>
              {suggestion.is_favorite && <Star className="h-4 w-4 shrink-0 text-primary" fill="currentColor" />}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
