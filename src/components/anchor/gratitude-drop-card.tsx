import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Send } from "lucide-react"
import { toast } from "sonner"
import { addGratitude } from "@/lib/gratitude"
import { JarIcon } from "@/components/anchor/jar-icon"

const MAX_LENGTH = 140

export function GratitudeDropCard() {
  const { t } = useTranslation()
  const [text, setText] = useState("")
  const [saving, setSaving] = useState(false)
  const [dropping, setDropping] = useState(false)

  async function handleDrop() {
    const trimmed = text.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await addGratitude(trimmed)
      setText("")
      setDropping(true)
      setTimeout(() => setDropping(false), 700)
      toast.success(t("jar.drop_success"))
    } catch (err) {
      console.error("Failed to add gratitude:", err)
      toast.error(t("jar.drop_error"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-0 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <JarIcon className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">{t("jar.drop_title")}</p>
        </div>

        <div className="relative flex items-center gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
            placeholder={t("jar.drop_placeholder")}
            maxLength={MAX_LENGTH}
            onKeyDown={(e) => e.key === "Enter" && handleDrop()}
            className="border-0 bg-muted/50 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
          <Button
            size="icon"
            onClick={handleDrop}
            disabled={!text.trim() || saving}
            aria-label={t("jar.drop_button")}
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>

          {dropping && (
            <span className="pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 text-base animate-jar-drop">
              🫙
            </span>
          )}
        </div>

        <div className="mt-1.5 flex justify-end">
          <span className="text-[10px] text-muted-foreground">{t("jar.char_count", { count: text.length, max: MAX_LENGTH })}</span>
        </div>
      </CardContent>
      <style>{`
        @keyframes jar-drop {
          0% { transform: translateY(-12px) scale(1); opacity: 1; }
          100% { transform: translateY(28px) scale(0.35); opacity: 0; }
        }
        .animate-jar-drop {
          animation: jar-drop 0.7s ease-in forwards;
        }
      `}</style>
    </Card>
  )
}
