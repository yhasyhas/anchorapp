import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Footprints, Plus } from "lucide-react"
import type { MoveSuggestion } from "@/types"

const defaultSuggestions: Omit<MoveSuggestion, "id" | "user_id" | "created_at">[] = [
  { title: "Take a 15 min walk", category: "physical", is_custom: false },
  { title: "Sit somewhere new", category: "novelty", is_custom: false },
  { title: "Text someone you trust", category: "social", is_custom: false },
  { title: "Listen to your favorite playlist", category: "mindful", is_custom: false },
  { title: "Do a 10 min stretch", category: "physical", is_custom: false },
]

const categoryIcons: Record<string, string> = {
  physical: "\u{1F333}",
  novelty: "\u{1FA91}",
  social: "\u{1F48C}",
  mindful: "\u{1F3A7}",
}

type AnchorType = "future" | "mindbody" | "life"

export function MovePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [suggestions, setSuggestions] = useState<MoveSuggestion[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [showAnchorModal, setShowAnchorModal] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [newCategory, setNewCategory] = useState<string>("physical")

  useEffect(() => {
    if (user) loadSuggestions()
  }, [user])

  async function loadSuggestions() {
    if (!user) return
    const { data } = await supabase
      .from("move_suggestions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    setSuggestions(data ?? [])
  }

  async function addCustomSuggestion() {
    if (!user || !newTitle.trim()) return
    const { data } = await supabase
      .from("move_suggestions")
      .insert({
        user_id: user.id,
        title: newTitle.trim(),
        category: newCategory,
        is_custom: true,
      })
      .select()
      .maybeSingle()

    if (data) setSuggestions([data, ...suggestions])
    setNewTitle("")
    setShowAddModal(false)
  }

  async function addToAnchor(type: AnchorType) {
    if (!user || !selectedSuggestion) return
    const today = new Date().toISOString().split("T")[0]

    const field = type === "future" ? "future_task"
      : type === "mindbody" ? "mindbody_task"
      : "life_task"

    await supabase
      .from("daily_anchors")
      .upsert(
        { user_id: user.id, date: today, [field]: selectedSuggestion },
        { onConflict: "user_id,date" }
      )

    setShowAnchorModal(false)
    setSelectedSuggestion("")
  }

  const allSuggestions = [
    ...suggestions,
    ...defaultSuggestions
      .filter((d) => !suggestions.some((s) => s.title === d.title))
      .map((d, i) => ({ ...d, id: `default-${i}`, user_id: "", created_at: "" })),
  ] as MoveSuggestion[]

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Footprints className="h-5 w-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold">{t("move.title")}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("move.subtitle")}</p>
      </div>

      <div className="space-y-3">
        {allSuggestions.map((suggestion) => (
          <Card key={suggestion.id} className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className="text-lg">{categoryIcons[suggestion.category] ?? "\u{1F333}"}</span>
                <p className="text-sm font-medium text-foreground">{suggestion.title}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary"
                onClick={() => {
                  setSelectedSuggestion(suggestion.title)
                  setShowAnchorModal(true)
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button
        variant="outline"
        className="w-full border-dashed border-primary/30 text-primary"
        onClick={() => setShowAddModal(true)}
      >
        <Plus className="mr-2 h-4 w-4" />
        {t("move.add_custom")}
      </Button>

      {/* Add Custom Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">{t("move.add_custom")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="..."
            />
            <div className="flex flex-wrap gap-2">
              {Object.entries(categoryIcons).map(([cat, icon]) => (
                <button
                  key={cat}
                  onClick={() => setNewCategory(cat)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    newCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {icon} {cat}
                </button>
              ))}
            </div>
            <Button onClick={addCustomSuggestion} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              {t("move.add_custom")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add to Anchor Modal */}
      <Dialog open={showAnchorModal} onOpenChange={setShowAnchorModal}>
        <DialogContent className="max-w-sm border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
          <DialogHeader>
            <DialogTitle className="font-heading">{t("move.choose_anchor")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addToAnchor("future")}
            >
              <span className="mr-2">&#x1F331;</span> {t("anchors.future")}
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addToAnchor("mindbody")}
            >
              <span className="mr-2">&#x1F9E0;</span> {t("anchors.mindbody")}
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => addToAnchor("life")}
            >
              <span className="mr-2">&#x1F30D;</span> {t("anchors.life")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
