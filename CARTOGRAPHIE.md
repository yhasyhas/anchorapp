# CARTOGRAPHIE.md — Anchor : contrat de base pour la refonte Home

> Document vivant, mis à jour au fil des lots (Mission 1 → 4). Produit le 2026-08-11 sur la branche `feature/capacitor-mobile`, par relecture croisée du code réel (pas de la doc existante, qui est partiellement obsolète — voir écarts notés en bas de chaque section).
>
> **Portée** : ce rapport cartographie l'existant avant toute refonte visuelle du Home. Sections (a) à (f) = Mission 1 (lecture seule). Section « Mission 2 » = proposition de tokens + palette claire miroir. Section « Mission 3 » = iconographie (`<AppIcon>`). Section « Mission 4 » = stratégie de branches. Un « Journal des changements » en fin de fichier liste, fichier par fichier, ce qui a réellement été modifié dans le code au fil des lots suivants.

---

## (a) Inventaire complet des features

33 features identifiées. Tableau : nom · emplacement (pages/composants/lib) · tables Supabase · edge functions · description courte.

| # | Feature | Emplacement | Tables Supabase | Edge function / API | Description |
|---|---|---|---|---|---|
| 1 | Cycle quotidien (mood → anchors → check-in) | `src/pages/home.tsx`, `src/pages/checkin.tsx`, `src/hooks/use-daily-cycle.ts`, `src/hooks/use-checkin.ts`, `src/components/anchor/morning-ritual.tsx`, `evening-release-animation.tsx`, `gentle-nudge-modal.tsx` | `mood_logs`, `daily_anchors`, `check_ins` | AI follow-up via `ai-service.ts` → `/api/insights` | Cœur de l'app : 3 « anchors » (Future/Mind-Body/Life) + intention le matin, coché dans la journée, check-in du soir. |
| 2 | Intentions personnalisées | `src/lib/custom-intentions.ts`, `src/hooks/use-custom-intentions.ts`, `src/components/settings/custom-intentions-section.tsx` | `custom_intentions` | `translateCustomIntention` (ai-service.ts) | Jusqu'à `MAX_ACTIVE_CUSTOM_INTENTIONS` (3) intentions perso au-delà des 5 par défaut, auto-traduites EN/SW. |
| 3 | Gratitude Jar | `src/lib/gratitude.ts`, `src/pages/jar.tsx`, `src/components/anchor/jar-icon.tsx`, `jar-opening-modal.tsx`, `gratitude-drop-card.tsx`, `gratitude-reminder-card.tsx` | `gratitudes` | — | Notes de gratitude quotidiennes « déposées » dans un bocal ; ouverture aléatoire du bocal ; relance après 2 jours de mood bas. |
| 4 | Voice encouragements + réponses vocales (Circle) | `src/lib/circle-voice.ts`, `src/hooks/use-voice-recorder.ts`, `src/pages/circle.tsx` | `circle_voice_encouragements` | `api/circle/notify-voice-encouragement.ts` + RPC `circle_send_voice_encouragement` | Notes vocales (≤20s) envoyées à un membre du cercle, avec réponse possible. |
| 5 | Lettres futures + relances | `src/lib/future-letters.ts`, `src/pages/letters.tsx`, `letter-future-write.tsx`, `letter-future-detail.tsx` | `future_letters` | `api/cron/reminders.ts` | Lettre à soi-même livrée dans 1 ou 3 mois (max `MAX_PENDING_LETTERS`=3), relance push à échéance. |
| 6 | Lettres hebdomadaires (IA) | `src/pages/letters.tsx`, `letter-detail.tsx`, `src/lib/letters.ts` | `weekly_letters` | `api/cron/weekly-letter.ts` | Lettre réflexive hebdo générée par IA, ton-aware, partageable au cercle. |
| 7 | Circle of Trust (cœur) | `src/lib/circle.ts`, `src/pages/circle.tsx`, `src/pages/circle-invite.tsx`, `circle-invite-nudge.tsx`, `circle-share-explainer.tsx`, `settings/circle-section.tsx` | `circle_memberships`, `circle_invites`, `circle_encouragements` | `notify-invite.ts`, `send-invite-email.ts`, `notify-encouragement.ts` | Cercle de confiance max 2 membres, invitations, présence quotidienne, encouragements texte. |
| 8 | SOS / « SOS doux » | `src/components/anchor/sos-widget.tsx`, `src/lib/circle-sos.ts` | `circle_sos` | `api/circle/notify-sos.ts` + `generateReassuranceMessage` (ai-service.ts) | Signal « j'ai besoin de toi » sans contenu envoyé au cercle ; fallback IA si pas de cercle. |
| 9 | Intentions partagées (Circle) | `src/lib/circle-intentions.ts` (consommé dans `circle.tsx` et `home.tsx`) | `circle_shared_intentions` | — | Un membre propose l'intention du jour à l'autre ; pré-remplissage non destructif sur Home. |
| 10 | Grace Gift | `src/lib/circle-grace.ts` (surfacé `home.tsx`, `circle.tsx`) | `circle_grace_gifts`, `anchor_streak_milestones_log` | — | Un membre du cercle peut « pardonner » un streak cassé du destinataire. |
| 11 | Milestones & anniversaires du cercle | `src/lib/circle-milestones.ts`, `circle-anniversary.ts` | lecture `circle_encouragements`/`circle_memberships`, état « vu » en localStorage | — | Célébrations ponctuelles (nb d'encouragements, mois d'ancienneté du cercle). |
| 12 | Soundscapes | `src/lib/soundscape.ts`, `soundscape-player.ts`, `soundscape-file.ts`, `src/hooks/use-soundscape.ts` | aucune (client + fichiers audio) | — | Fond sonore ambiant (pluie/vagues/forêt) optionnel pendant la respiration guidée (morning ritual + Pause). |
| 13 | Wrapped (récap mensuel) + historique | `src/pages/wrapped.tsx`, `wrapped-history.tsx`, `src/lib/wrapped.ts`, `wrapped-share.ts` | `monthly_recaps` | génération via cron partagé avec `weekly-letter.ts` | Deck de cartes façon « Spotify Wrapped » dès `MIN_WRAPPED_DAYS` (8) jours de data ; partage/export image. |
| 14 | Progress Stories | surfacé `src/pages/patterns.tsx` | `progress_stories` | `api/cron/weekly-letter.ts` (fenêtre glissante 21j, min 10 jours actifs) | Récit IA glissant des 3 dernières semaines. |
| 15 | Mode sombre | `src/components/mode-toggle.tsx`, `src/components/theme-provider.tsx` | aucune | — | Toggle light/dark/system, disponible dans Settings — détail complet en (d). |
| 16 | Streaks (« with meaning ») | `src/lib/streaks.ts`, `streak-milestone-modal.tsx`, affiché sur `home.tsx` | dérivé de `mood_logs`/`daily_anchors` + `anchor_streak_milestones_log` | — | Streaks mood (strict) et anchors (tolérance grâce), célébration à 7/14/21/30 jours, phrase liée à l'intention dominante. |
| 17 | Companion (message du matin) | `generateCompanionMessage` (`ai-service.ts`), rendu + TTS sur `home.tsx` | lit `mood_logs`, `check_ins`, `profiles` | `/api/insights` (Groq) | Salutation IA courte, ton-aware, lisible à voix haute (`speech.ts`). |
| 18 | Soft Mode | `src/lib/soft-mode.ts`, `use-soft-mode.ts`, `soft-mode-nudge-card.tsx`, `soft-mode-badge.tsx`, `settings/soft-mode-section.tsx` | `profiles.soft_mode` | — | Mode allégé auto-suggéré après 3 jours de mood bas ; check-in réduit à 1 question. |
| 19 | Journal (1 phrase) + export PDF | `src/components/anchor/journal-card.tsx`, `journal-questions.ts`, `settings/journal-export-section.tsx`, `src/lib/pdf/*` | `journal_entries` | `api/transcribe.ts` (Groq Whisper) | Prompt quotidien texte/vocal (≤25s) ; export PDF mensuel via cartes canvas. |
| 20 | Onboarding | `src/components/onboarding/onboarding-modal.tsx` | `profiles.onboarded_at`, `notification_preferences` | — | 4 étapes : ton, préférences de rappel + opt-in push, intention de vie optionnelle. |
| 21 | Tone Picker | `src/components/tone-picker.tsx`, `settings/tone-section.tsx` | `profiles.tone` | — | gentle / direct / poetic — reformate toutes les copies IA de l'app. |
| 22 | Push notifications (FCM natif + Web Push) & quiet hours | `src/lib/push.ts`, `push-nudge.tsx`, `settings/reminders-section.tsx` | `push_subscriptions`, `push_tokens`, `notification_preferences`, `notification_log` | `api/send-push.ts` (dual Web-Push/FCM), `api/cron/reminders.ts` | Système de rappel cross-plateforme avec quiet hours et fuseau horaire. |
| 23 | AI Insights (3 paliers) | `src/pages/patterns.tsx`, `src/lib/ai-service.ts` | `insight_log`, `ai_request_log` | `api/insights.ts` | Palier 1/2 local (règles), palier 3 IA (edge, cache hebdo). |
| 24 | Move of the Day | `src/pages/move.tsx`, `move-of-the-day-card.tsx`, `move-picker-sheet.tsx`, `src/lib/move-selection.ts` | `move_suggestions` | `generateMoveSuggestions` (ai-service.ts) | Suggestion d'activité par catégorie, corrélée au mood. |
| 25 | Pause (respiration / focus / recentrage) | `pause-modal.tsx`, `pause-breathing.tsx`, `pause-focus-session.tsx`, `pause-recenter.tsx`, `breathing-session.tsx` | aucune | — | Menu « pause » flottant avec 3 outils interactifs. |
| 26 | Suppression de compte | `src/pages/settings.tsx`, `api/delete-account.ts` | `action_rate_log` | `api/delete-account.ts` | Suppression self-service avec confirmation par email, rate-limited. |
| 27 | Question de suivi IA / réassurance | `generateFollowUpQuestion`, `generateReassuranceMessage` (`ai-service.ts`) | `check_ins.personal_question` | `/api/insights` | Question de check-in personnalisée + message de réassurance SOS sans cercle. |
| 28 | Offline / file de synchro | `src/lib/offline-sync.ts` | écrit vers la table ciblée à la reconnexion | — | Cache local + queue, flush sur `online` et changement de route — voir CLAUDE.md pour le pattern à suivre. |
| 29 | PWA install / update | `src/components/pwa/install-prompt.tsx`, `pwa-update-toast.tsx` | aucune | — | Prompt « ajouter à l'écran d'accueil » et toast de mise à jour SW (web uniquement). |
| 30 | Deep linking natif | `src/components/deep-link-handler.tsx` | aucune | — | Intercepte les App Links Android (`appUrlOpen`) et route via react-router. |
| 31 | Auth | `src/pages/login.tsx`, `register.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `src/lib/auth-context.tsx` | Supabase Auth, `profiles` | — | Login/register/reset standard. |
| 32 | Landing page | `src/pages/landing.tsx`, `src/components/landing/*` | aucune | — | Page marketing publique. |
| 33 | Page confidentialité | `src/pages/privacy.tsx` | aucune | — | Statique. |

**Infra transverse notable** : `src/lib/i18n.ts` + `src/locales/{en,sw}.json` (i18n complète EN/SW) ; `src/lib/pdf/*` + `canvas-utils.ts` (rendu canvas partagé Wrapped/Journal) ; `src/lib/native-file-share.ts`, `letter-share.ts`, `wrapped-share.ts` (partage/téléchargement unifié natif/web) ; `src/lib/user-storage.ts`, `local-flags.ts` (localStorage scopé par user, utilisé par la quasi-totalité des nudges « vu une fois »).

**Écart avec CLAUDE.md** : le fichier CLAUDE.md à la racine ne documente que le noyau du cycle quotidien et l'IA à 3 paliers — il ne mentionne ni Gratitude Jar, ni Circle of Trust (invite/SOS/grace gift/voice), ni lettres futures, ni Wrapped, ni Soft Mode, ni soundscapes, ni push natif FCM en détail. Ce CARTOGRAPHIE.md fait foi pour l'inventaire de features ; CLAUDE.md reste correct sur l'architecture générale (routing, offline-sync, i18n) mais est à considérer comme partiel côté features.

---

## (b) Inventaire des composants UI réutilisables

### `src/components/ui/*` — primitives shadcn ("new-york")

Aucun `tailwind.config.*` : Tailwind v4 CSS-first, tout est déclaré dans `src/index.css`. `components.json` : `style: "new-york"`, `baseColor: "neutral"` (personnalisé ensuite), `cssVariables: true`.

Primitives centrales et leurs variantes :

| Composant | Variantes |
|---|---|
| `button.tsx` | `variant`: default, destructive, outline, secondary, ghost, link · `size`: default, xs, sm, lg, icon, icon-xs, icon-sm, icon-lg · `asChild` |
| `card.tsx` | `Card/CardHeader/CardTitle/CardDescription/CardAction/CardContent/CardFooter` — pas de variantes, layout pur |
| `badge.tsx` | `variant`: default, secondary, destructive, outline, ghost, link |
| `input.tsx` | style unique |
| `sheet.tsx` | `side`: top/right/bottom/left (défaut right) |
| `dialog.tsx` | `showCloseButton` sur Content et Footer |
| `tabs.tsx` | `TabsList` variant: default, line · orientation h/v |
| `switch.tsx` | `size`: sm, default |
| `select.tsx` | `SelectTrigger size`: sm/default |
| `textarea.tsx` | style unique, auto-sizing |

Autres primitives présentes (non détaillées, usage ponctuel) : `accordion`, `alert-dialog`, `alert`, `aspect-ratio`, `avatar`, `breadcrumb`, `button-group`, `calendar`, `carousel`, `chart`, `checkbox`, `collapsible`, `command`, `context-menu`, `direction`, `drawer`, `dropdown-menu`, `empty-state`, `empty`, `field`, `form`, `hover-card`, `input-group`, `input-otp`, `item`, `kbd`, `label`, `menubar`, `native-select`, `navigation-menu`, `pagination`, `popover`, `progress`, `radio-group`, `resizable`, `scroll-area`, `separator`, `skeleton`, `slider`, `sonner` (toasts), `spinner`, `table`, `toggle-group`, `toggle`, `tooltip`.

⚠️ `empty-state.tsx` et `empty.tsx` coexistent (probablement une version maison simple + le primitif shadcn complet) — à dédupliquer si on consolide le design system.

### `src/components/anchor/*` — composants métier du cycle quotidien

`breathing-session.tsx`, `confetti.tsx` (`ConfettiBurst`, respecte `prefers-reduced-motion`), `evening-release-animation.tsx` (idem), `gentle-nudge-modal.tsx`, `gratitude-drop-card.tsx`, `gratitude-reminder-card.tsx`, `jar-icon.tsx` (`JarIcon` — seul SVG custom réutilisé, cf. (c)), `jar-opening-modal.tsx`, `journal-card.tsx`, `morning-ritual.tsx`, `move-of-the-day-card.tsx`, `move-picker-sheet.tsx`, `pause-breathing.tsx`, `pause-focus-session.tsx`, `pause-modal.tsx`, `pause-recenter.tsx`, `push-nudge.tsx`, `soft-mode-badge.tsx`, `soft-mode-nudge-card.tsx`, `sos-widget.tsx`, `streak-milestone-modal.tsx`.

### Autres groupes

- **`src/components/circle/*`** : `circle-invite-nudge.tsx`, `circle-share-explainer.tsx`.
- **`src/components/settings/*`** : `circle-section.tsx`, `custom-intentions-section.tsx`, `journal-export-section.tsx`, `reminders-section.tsx`, `soft-mode-section.tsx`, `tone-section.tsx`.
- **`src/components/onboarding/*`** : `onboarding-modal.tsx` (4 étapes, réutilise `TonePicker`).
- **`src/components/pwa/*`** : `install-prompt.tsx`, `pwa-update-toast.tsx`.
- **Top-level** : `tone-picker.tsx`, `mode-toggle.tsx`, `deep-link-handler.tsx`, `theme-provider.tsx`, `src/components/landing/*` (site public, hors design system in-app).

### Bottom nav / tab bar

Pas de composant dédié — défini inline dans `src/pages/app-layout.tsx` (`navItems`, ~lignes 16-21, rendu ~119-136) :

| Route | Icône (lucide) | Label |
|---|---|---|
| `/` | `Home` | `home.title` |
| `/patterns` | `BarChart3` | `patterns.title` |
| `/checkin` | `Heart` | `checkin.title` |
| `/move` | `Footprints` | `move.title` |

État actif : `text-primary scale-105`. Inactif : `text-muted-foreground hover:text-foreground`. Un bouton flottant « Pause » (bas-droite, emoji `☁️` sans lucide) ouvre `PauseModal`, co-localisé dans le même layout mais hors du tab bar.

**Aucune abstraction `<AppIcon>` n'existe aujourd'hui** — cf. Mission 3.

---

## (c) Inventaire des icônes

### Lucide (bibliothèque dominante)

`lucide-react` ^1.6.0 est importé dans **65 fichiers** (28 fichiers « app » + 24 primitives `ui/*` + quelques autres). Aucune autre bibliothèque d'icônes n'est installée (pas de react-icons, heroicons, phosphor, radix-icons, fontawesome).

Icônes les plus utilisées (>3 fichiers) : `Loader2`(15), `Heart`(11), `Sparkles`(11), `Anchor`(10, logo de facto), `Mail`(8), `ArrowLeft`(7), `Square`(4), `X`(4). ~30 icônes à usage unique (`Send`, `Feather`, `Compass`, `Home`, `BarChart3`, `Flame`, `Lock`, etc.).

⚠️ Convention divergente : le code métier importe les noms bruts (`Check`, `X`, `ChevronRight`, `ChevronDown`), tandis que les primitives `ui/*` générées par shadcn importent les mêmes glyphes suffixés `Icon` (`CheckIcon`, `XIcon`, `ChevronRightIcon`, `ChevronDownIcon`). Même icône, deux conventions de nommage — à harmoniser si on standardise (Mission 3a).

### SVG custom inline (2 composants seulement)

- **`src/components/anchor/jar-icon.tsx`** (`JarIcon`) : le seul vrai « icône signature » existant. `viewBox="0 0 64 64"`, `stroke`/`fill="currentColor"` (theme-adaptive) + un fill lié à `var(--sage-light)`. Pas de variante remplie/active. Réutilisé à 7 endroits (jar.tsx, gratitude-drop-card, jar-opening-modal ×3, home.tsx, gratitude-reminder-card).
- **`src/components/ui/empty-state.tsx`** : 4 icônes décoratives inline (`flower`, `cloud`, `moon`, `seedling`), `viewBox="0 0 64 64"`, theme-adaptive via classes Tailwind (`text-rose-accent/60` etc.), pas de variante active (usage illustratif uniquement).

### Emoji utilisés comme icônes (hors chaînes traduites)

C'est la vraie zone à standardiser pour la Mission 3. Principaux relevés :

| Zone | Emoji | Fichier |
|---|---|---|
| **Sélecteur de mood (UI principale, pas un mock)** | 😊🙂😐🙁😣 | `src/lib/constants.ts` (`moodConfig`), consommé par `home.tsx` et `checkin.tsx` — **aucun équivalent lucide/SVG n'existe** |
| Bouton flottant Pause | ☁️ | `app-layout.tsx:144`, sans aria-label dédié |
| Modale Pause | 🧘🌬️🌱💬 | `pause-modal.tsx` |
| Cartes anchors (planning) | 🌱 (future) 🧠 (mindbody) 🌍 (life) | `home.tsx:601-624`, passées en `string` brute |
| Catégories Move | 🌳🪑💌🎧🎨🛌 | `move.tsx:32-39` |
| Lettres (scellée/ouverte) | 💌 | `letters.tsx`, `letter-future-detail.tsx`, `letter-future-write.tsx` — **aucune distinction visuelle entre lettre scellée et lettre prête à ouvrir**, les deux utilisent le même emoji |
| Circle (anniversaires) | 🌱 | `circle.tsx:585,730` (le SOS du Circle, lui, utilise déjà le lucide `HeartHandshake`) |
| Streaks | 🔥 (mood) ⚓ (anchors) | `home.tsx` — doublon : la même info est déjà portée par les icônes lucide `Flame`/`AnchorIcon` juste à côté |
| Divers home/checkin | 🌻✨🎁🎉🌸💡🫙 | `home.tsx`, `checkin.tsx` |

Incohérence relevée : `JarIcon` (SVG signature) coexiste avec l'emoji 🫙 utilisé directement à 2 endroits (`checkin.tsx:179`, `gratitude-drop-card.tsx:66`) pour le même concept.

### Spot-check par zone (demandé en Mission 3)

- **Bottom nav** : 100% lucide, zéro emoji — la zone la plus propre de l'app, bonne base à étendre.
- **Logo app** : pas d'asset dédié, réutilise le lucide `Anchor` (login/register/forgot-password/reset-password/privacy/hero-section/onboarding). Les favicons `public/*.png` sont indépendants (PWA/OS uniquement).
- **Mood** : emoji uniquement — le chantier le plus visible de la Mission 3b.
- **Move/activité** : nav = lucide `Footprints`, mais les catégories internes sont en emoji.
- **Pause/SOS** : deux systèmes différents pour un même besoin de « soutien urgent » — bouton Pause flottant en emoji, SOS Circle en lucide `HeartHandshake`.
- **Gratitude Jar** : le candidat « signature icon » le plus mûr (SVG déjà réutilisé 7×), à normaliser (retirer les 2 fallback emoji).
- **Lettres scellée/ouverte** : à créer de zéro (aucun SVG, aucune distinction visuelle actuelle).
- **Circle of Trust** : pas d'icône dédiée, mélange lucide + 🌱.
- **Intention** : déjà bien standardisé sur lucide `Sparkles`, sauf 2 endroits où un ✨ emoji fait doublon.

---

## (d) Système de thème actuel

**Tailwind v4 CSS-first** — aucun `tailwind.config.*`, tout dans `src/index.css` via `@import "tailwindcss"` + `@theme inline { ... }`. `@custom-variant dark (&:is(.dark *))` : dark mode par classe `.dark` sur `<html>`, pas `prefers-color-scheme` seul.

### Tokens actuels (`:root`, thème clair)

```
--radius: 1.25rem  (→ --radius-sm/md/lg/xl via calc() dans @theme)
--background: #F9F7F2      --foreground: #3D3D3D
--card: #FDFBF7             --popover: #FFFFFF
--primary: #7A8B6E           --primary-foreground: #FFFFFF
--secondary/--muted: #F5F1E8 --muted-foreground: #8A8A8A
--accent: #E8EDE5            --destructive: #E8C4C4
--border/--input: #E8E4DC    --ring: #7A8B6E
--sage: #7A8B6E   --sage-light: #E8EDE5
--rose-accent: #E8C4C4   --lavender: #D4C5E8   --peach: #F5D5C5
--mood-stressed: #F5D5D5
--font-heading: "Playfair Display", serif
--font-body: "Inter", sans-serif
```

### `.dark` (thème sombre actuel)

```
--background: #1C1B1A   --foreground: #EAE6DD
--card: #242220          --primary: #93A67F (primary-foreground: #1C1B1A)
--secondary/--muted: #232120   --muted-foreground: #A69F93
--accent: #2E3A29   --destructive: #B8726E
--border/--input: #37342F   --ring: #93A67F
--sage: #93A67F   --sage-light: #2E3A29
--rose-accent: #C98A87   --lavender: #A98FD1   --peach: #C9895B
--mood-stressed: #C36E78
```

**Fait important pour la Mission 2** : `--font-heading` (Playfair Display) et `--font-body` (Inter) sont **déjà** les polices chargées (Google Fonts, `index.html`, poids 300-700 + italique 400), déjà appliquées globalement (`h1..h6` → heading, `body` → body). Rien à changer côté typographie pour respecter le guide de Ruth.

### Mécanisme dark mode

Provider maison `src/components/theme-provider.tsx` (pas `next-themes`, bien que le paquet soit listé en dépendance dans `package.json` — semble inutilisé, à vérifier/nettoyer à l'occasion). `Theme = "light" | "dark" | "system"`, persisté dans `localStorage["theme"]`, sync cross-tab, écoute live de `prefers-color-scheme`, raccourci clavier `d`, script anti-FOUC inline dans `index.html`, et **synchronisation de la status bar native Capacitor** (`THEME_COLORS` = copie codée en dur de `--primary`/`--background` clair et sombre — à mettre à jour si la palette change, cf. Mission 2).

### Discipline des couleurs

Quasi 100% des composants consomment les tokens sémantiques (`bg-primary`, `text-muted-foreground`, `border-rose-accent`...) — zéro classe Tailwind de palette brute (`bg-red-500` etc.) trouvée. Seules exceptions à hex codés en dur, **toutes justifiées et commentées dans le code** :
- `theme-provider.tsx` (`THEME_COLORS`, status bar native)
- `src/lib/pdf/palette.ts` (export PDF — canvas ne lit pas les CSS vars, snapshot volontaire du thème clair)
- `src/lib/wrapped-share.ts`, `src/lib/letter-share.ts` (cartes de partage canvas, même raison)

Ces 3 fichiers export/canvas ne suivront **pas** automatiquement les nouveaux tokens de la Mission 2 — décision à prendre séparément (garder le rendu clair actuel pour les exports, ou dupliquer une palette sombre pour eux). Non traité dans ce lot.

### Spacing / radius

Radius : source unique `--radius: 1.25rem`, 202 usages de `rounded-*` dans 79 fichiers, aucune valeur arbitraire relevée. Spacing : échelle Tailwind standard (664 usages, 95 fichiers), pas de tokens `--space-*` dédiés aujourd'hui — l'introduction d'une grille 8pt nommée (Mission 2) est donc additive, pas un conflit.

---

## (e) Divergences web/mobile déjà présentes

Stratégie actuelle : **un seul code source, branchement runtime** via `Capacitor.isNativePlatform()` (`@capacitor/core`) — aucun fork de logique métier, aucun bundle séparé.

Plugins installés : `@capacitor/{android,app,cli,core,filesystem,haptics,network,push-notifications,share,splash-screen,status-bar}` + `@capacitor/assets` (dev, génération icônes/splash). Pas de plugin caméra/géoloc/audio natif.

| Fichier | Plugin(s) | Divergence |
|---|---|---|
| `src/lib/push.ts` | push-notifications | Web Push/VAPID (`push_subscriptions`) vs FCM natif (`push_tokens`), dispatché par `isNativePlatform()` |
| `src/lib/native-file-share.ts` | filesystem, share | Web: `<a download>` / Natif: écrit dans `Directory.Cache` puis partage natif |
| `src/components/deep-link-handler.tsx` | app | Natif uniquement (early-return sur web), route les App Links Android |
| `src/pages/home.tsx`, `src/hooks/use-daily-cycle.ts` | haptics | `Haptics.impact()`, fallback silencieux web (`.catch()`) |
| `src/pages/app-layout.tsx` | core, network | Bannière offline via `Network`, `InstallPrompt` masqué sur natif |
| `src/lib/offline-sync.ts` | network | `Network.getStatus()` remplace `navigator.onLine`, ~20 sites d'appel |
| `src/components/theme-provider.tsx` | core, status-bar | Sync status bar native uniquement |
| `src/main.tsx` | core, splash-screen | `PwaUpdateToast` masqué sur natif, `SplashScreen.hide()` piloté par React |

`capacitor.config.ts` : `appId: com.anchorapp.app`, `webDir: dist`, `SplashScreen.launchAutoHide: false` + `backgroundColor: #F9F7F2` (== thème clair actuel — **à resynchroniser si le fond change en Mission 2**).

`android/` committé en entier (convention Capacitor, confirmé par `git ls-files`), y compris `google-services.json` (volontairement non-gitignored, justifié en commit `3f94e81`). Permissions manifest : `INTERNET`, `RECORD_AUDIO` (ajoutée pour `getUserMedia`/`MediaRecorder`, pas de plugin audio natif — **les notes vocales utilisent le même code Web API sur les deux plateformes, zéro branchement**), `FileProvider`.

Deep linking : intent-filters `autoVerify` pour `/reset-password*` et `/circle/invite*` + `public/.well-known/assetlinks.json`.

Fichiers **exclusivement natifs** (sans équivalent web) : `capacitor.config.ts`, tout `android/*`, `resources/icon.png`. Fichiers **exclusivement web/PWA** : `public/manifest.json`, le bloc `VitePWA` de `vite.config.ts`, `src/components/pwa/*`.

→ Repris et développé en section « Mission 4 ».

---

## (f) Points de contact du Home — ce que la refonte ne doit PAS casser

Lecture directe de `src/pages/home.tsx` (936 lignes). Le Home orchestre énormément d'état venant d'ailleurs — toute refonte visuelle doit continuer à monter/appeler exactement ces éléments, avec les mêmes props/hooks :

- **Header** : badges non-lus sur Mail (lettres), Heart (circle), plus liens Wrapped/Jar/Settings — piloté par `useHomeBadges(user, profile)` → `hasUnreadLetter`, `hasPendingCircleInvite`, `hasUnreadEncouragement`.
- **Modales globales montées ici** : `OnboardingModal`, `MorningRitual`, `GentleNudgeModal` (piloté par `cycle.nudgeOpen`/`nudgeType`), `StreakMilestoneModal`, `JarOpeningModal`, `MovePickerSheet`, `ConfettiBurst`.
- **Companion (message du matin)** : carte dédiée, `cycle.companionMsg`, bouton lecture vocale (`isSpeechSynthesisAvailable`/`speak`/`stopSpeaking`).
- **Slot de nudge unique** (`useNudgeArbitration`) : au plus une carte à la fois parmi Soft Mode enter/exit, `GratitudeReminderCard`, `PushNudge`, teaser Wrapped — logique d'arbitrage de priorité à préserver telle quelle.
- **Move of the Day** : `MoveOfTheDayCard`, visible seulement en mode planning et si un anchor cible est vide.
- **Barre de progression du cycle** (mood/anchors/checkin) + **Grace gift** (`cycle.graceGift`, nom du membre via `getMemberNames()`).
- **Streaks** (`StreakCard` ×2, mood + anchors) — bascule de layout (side-by-side → empilé) dès qu'un streak dépasse `MIN_STREAK_FOR_INTENTION`.
- **Sélecteur de mood**, **carte Intention du jour** (inclut intentions custom, `useCustomIntentions`), **3 cartes Anchors** (mode planning avec `PlanningAnchorCard`/`SoftAnchorPicker`, mode tracking avec `TrackingAnchorCard` + time-gate `canCheckAnchors`), **JournalCard**, **GratitudeDropCard**, **carte « message de soutien »**, **`SosWidget`** en pied de page.
- **Soft Mode** (`useSoftMode`) : bascule l'affichage complet des 3 anchors vers un picker à un seul anchor + badge dédié dans le header.
- **Intentions partagées du Circle** : pré-remplissage one-shot non destructif (`sharedIntentionAppliedRef`).

Aucune de ces intégrations ne doit être retirée ou re-câblée différemment par la future refonte visuelle — seule l'habillage (tokens, icônes) change dans ce lot.

---

## Mission 2 — Design tokens Anchor (proposition)

**Implémentation additive** : les nouveaux tokens sont ajoutés à `src/index.css` en suivant le pattern déjà en place (`--sage`, `--rose-accent`, etc. → nouvelle famille `--anchor-*`), sans toucher aux écrans. Le thème sombre de Ruth devient la nouvelle définition de `.dark`; le thème clair actuel reste inchangé jusqu'à validation de la palette miroir proposée ci-dessous.

### Palette sombre (officielle, celle du guide)

| Token | Valeur | Rôle |
|---|---|---|
| `--anchor-background` | `#0F0F10` | Fond global |
| `--anchor-surface` | `#17171A` | Cartes / surfaces niveau 1 |
| `--anchor-surface-2` | `#1F1F23` | Surfaces niveau 2 (inputs, sheets) |
| `--anchor-gradient-dark` | `#2A2A31` | Fin de dégradé sur surfaces élevées |
| `--anchor-green` | `#A7C48C` | Primary / Future |
| `--anchor-warm-cream` | `#F2D8B6` | Texte principal chaud / accent |
| `--anchor-orange` | `#E9B072` | Mood / chaleur active |
| `--anchor-lavender` | `#B78CFF` | Life / accent secondaire |
| `--anchor-pink` | `#F48FB1` | Mind-Body |
| `--anchor-soft-green` | `#8FD3A1` | Accent support |

**Vérification de contraste (WCAG 2.1, formule de luminance relative)** : `--anchor-green` (#A7C48C) sur `--anchor-background` (#0F0F10) → ratio ≈ **9.8:1** (AAA texte normal). `--anchor-pink` (#F48FB1, l'accent le plus sombre du set) sur `#0F0F10` → ratio ≈ **8.6:1**. `--anchor-warm-cream` sur `--anchor-surface` (#17171A) → ratio ≈ **13:1**. Toutes les couleurs d'accent listées dépassent largement le seuil AA (4.5:1) sur les deux fonds sombres, leur luminance étant très supérieure à celle du fond quasi-noir.

### Palette claire miroir — À VALIDER avant application

Le thème clair actuel (`#F9F7F2` / sage `#7A8B6E`) partage déjà la même famille de teintes (vert sauge, lavande, pêche) que la nouvelle palette sombre — bon signe de continuité. Proposition de miroir clair conservant les mêmes identités de teinte, recalibrées en luminosité/saturation pour rester AA sur fond clair (les couleurs claires du guide, utilisées telles quelles comme texte sur fond clair, échoueraient au contraste) :

| Rôle | Sombre (guide) | Clair proposé | Contraste sur fond clair proposé |
|---|---|---|---|
| Background | `#0F0F10` | `#FAF8F4` (proche de l'actuel `#F9F7F2`, conservé) | — |
| Surface | `#17171A` | `#FFFFFF` | — |
| Surface-2 | `#1F1F23` | `#F5F1E8` (= `--secondary` actuel, réutilisé) | — |
| Primary / Future (Anchor-Green) | `#A7C48C` | `#6E8A55` (assombri depuis l'actuel `#7A8B6E`, même famille) | ≈4.9:1 sur `#FAF8F4` |
| Texte principal | `#F2D8B6` (crème, rôle *texte sur sombre*) | `#3D3D3D` (rôle *texte* inchangé — le crème devient un accent de fond chaud, pas du texte, sur le clair) | ≈10.9:1 |
| Mood / Orange | `#E9B072` | `#B96A2C` (assombri) | ≈4.6:1 |
| Life / Lavender | `#B78CFF` | `#7C55D6` (assombri) | ≈4.8:1 |
| Mind-Body / Pink | `#F48FB1` | `#C24E77` (assombri) | ≈4.7:1 |
| Support / Soft-Green | `#8FD3A1` | `#4C8F63` (assombri) | ≈4.6:1 |

Cette proposition **n'est pas encore appliquée** — elle est documentée ici pour validation par Ruth avant implémentation, conformément à la consigne. Une fois validée, elle rejoint `:root` sous le même schéma `--anchor-*` que le sombre.

### Typographie, spacing, radius

- Playfair Display Bold ~32/40 (greeting) et 28/36 (titres de section), Inter Regular 14/20 (corps), semibold réservé aux labels/contrôles — s'appuie sur `--font-heading`/`--font-body` déjà en place, ajout de tokens de taille (`--text-greeting`, `--text-section-title`) plutôt que classes ad hoc.
- Grille 8pt : tokens `--space-1` (8px) à `--space-8` (64px).
- Radius : `--radius-card-lg: 24px` (cartes majeures), `--radius-input: 16px`, `--radius-control-sm: 12px`. Bouton primaire : `min-height: 48px`, `border-radius: 24px`. Touch targets : `min 44px`.

Statut d'implémentation de cette section : voir Journal des changements en fin de fichier.

---

## Mission 3 — Iconographie

### Ce qui a été construit

- **`src/components/icons/app-icon.tsx`** — le composant `<AppIcon>` demandé en (e) : point unique de vérité pour toute icône de l'app. Une seule prop `icon` accepte soit un composant lucide-react (`icon={Home}`, les call sites existants n'ont pas besoin d'être réécrits — ils passent juste leur import lucide habituel), soit le nom d'une icône signature (`icon="gratitude-jar"`). Gère de façon centralisée : taille (`20 | 24`, pas d'autre valeur possible — force la discipline demandée en 3a), `strokeWidth` uniforme, état `active` (remplissage `currentColor` pour lucide comme pour les signatures), et accessibilité (`aria-label` obligatoire sauf `decorative` qui bascule sur `aria-hidden` — empêche structurellement l'oubli d'un label sémantique, cf. 3d).
- **`src/components/icons/signature/*`** — 9 icônes signature en SVG inline, `viewBox="0 0 24 24"`, trait arrondi (`strokeLinecap`/`strokeLinejoin: round`), 100% `currentColor` (adaptatif clair/sombre sans aucune couleur codée en dur), chacune avec une variante `active` remplie :
  - `AnchorMarkIcon` (logo) — alternative maison au lucide `Anchor` générique réutilisé comme logo à 10 endroits.
  - `GratitudeJarIcon` — pendant 24×24 du `JarIcon` 64×64 existant (`src/components/anchor/jar-icon.tsx`, conservé tel quel, voir « Non fait » ci-dessous).
  - `LetterSealedIcon` / `LetterOpenIcon` — première distinction visuelle jamais introduite entre une lettre future scellée et une lettre prête à ouvrir (les deux partagent aujourd'hui le même 💌, cf. Mission 1c).
  - `CircleOfTrustIcon` — n'existait pas du tout ; le Circle mélangeait plusieurs icônes lucide sans rapport entre elles.
  - `IntentionIcon` — **choix proposé : étincelle** plutôt que feuille (la feuille est déjà l'emoji 🌱 de l'anchor « Future », une étincelle évite la confusion) ; à valider ou inverser avec Ruth.
  - `MoodIcon`, `MoveIcon`, `PauseIcon` — versions signature génériques des concepts ; `PauseIcon` remplace concrètement l'emoji ☁️ du bouton flottant (seul remplacement d'emoji effectué dans ce lot, voir ci-dessous).
- **Bottom nav (`src/pages/app-layout.tsx`)** : les 4 icônes (`Home`, `BarChart3`, `Heart`, `Footprints`) passent maintenant par `<AppIcon>`. Onglet actif : remplissage `currentColor` (via `active`) + pastille `bg-primary` sous l'icône, animée (`animate-pulse`) sauf si `prefers-reduced-motion` est actif (`usePrefersReducedMotion()`, hook déjà existant dans le repo, réutilisé — pas de nouvelle logique de detection). Icônes marquées `decorative` (le label texte visible sous chaque icône reste l'accessible name du lien, donc pas de double annonce screen-reader).
- **Bouton flottant Pause** : remplace l'emoji ☁️ par `<AppIcon icon="pause" decorative />` — le seul autre changement visuel de ce lot, hors chrome de nav.

### Convention Lucide (3a)

L'audit (Mission 1c) montre que Lucide était déjà la base quasi-unique (65 fichiers, aucune autre lib). Le seul point d'hétérogénéité réel est la double convention de nommage `Check`/`CheckIcon`, `X`/`XIcon`, etc. entre code métier et primitives shadcn — les deux résolvent la même icône Lucide, ce n'est pas un défaut visuel, aucune action nécessaire.

### Non fait dans ce lot (délibérément, périmètre « fondation seule »)

Remplacer les emoji-icônes recensés en Mission 1c (sélecteur de mood, cartes anchors, catégories Move, lettres, streaks, Circle) toucherait directement l'écran Home et d'autres écrans — explicitement hors périmètre (« AUCUNE refonte visuelle du Home dans ce lot »). Backlog recommandé pour le lot de refonte, par ordre d'impact :
1. Sélecteur de mood (`src/lib/constants.ts` → `home.tsx`/`checkin.tsx`) — le plus visible, aucun équivalent SVG n'existe encore (`MoodIcon` signature créé ici est un concept générique, pas les 5 états).
2. Lettres scellée/ouverte (`letters.tsx`, `letter-future-*.tsx`) — `LetterSealedIcon`/`LetterOpenIcon` sont prêts à l'emploi.
3. `JarIcon` existant (7 usages) → migrer vers `GratitudeJarIcon` signature pour unifier le viewBox 24×24 et retirer les 2 fallback emoji 🫙 (`checkin.tsx`, `gratitude-drop-card.tsx`).
4. Catégories Move (`move.tsx`), anniversaires Circle (`circle.tsx`), doublons emoji+lucide sur les streaks (`home.tsx`).

---

---

## Mission 4 — Stratégie 2 branches (master/pwa vs feature/capacitor-mobile)

D'après la cartographie (e), la divergence actuelle est **structurellement propre** : un seul arbre de code, branché à l'exécution via `Capacitor.isNativePlatform()`. Aucune logique métier n'est dupliquée entre branches — la branche `feature/capacitor-mobile` n'ajoute que (1) des fichiers natifs sans équivalent web (`android/`, `capacitor.config.ts`, `resources/`), (2) quelques imports `@capacitor/*` dans des modules par ailleurs partagés, tous no-op sur le web.

### Ce qui doit rester strictement identique entre les 2 branches

Pour permettre des reports sans douleur : tous les fichiers de design (tokens `src/index.css`, `components.json`, tout `src/components/ui/*`, la future icônothèque signature et `<AppIcon>`) doivent rester **caractère pour caractère identiques** entre branches. Aucune de ces couches ne contient aujourd'hui de branchement Capacitor — c'est un renfort à préserver, pas une contrainte nouvelle. Concrètement : appliquer tout changement de tokens/icônes sur `feature/capacitor-mobile` (branche de travail actuelle) puis **cherry-pick** (pas de merge de branche complet) les commits touchant uniquement `src/index.css`, `src/components/ui/*`, `src/components/anchor/*Icon*` vers `master`/`pwa`.

### Unification à terme en branche unique — recommandation

**Faisable et recommandé à moyen terme**, mais pas dans ce lot. Arguments pour :
- Le pattern `Capacitor.isNativePlatform()` est déjà éprouvé sur 8 fichiers sensibles (push, partage, réseau, status bar, splash) sans aucune casse rapportée.
- `@capacitor/*` en dépendances sur `master` ne pénalise pas le web : ces plugins ont des fallbacks web natifs (Haptics → Vibration API ou no-op) ou sont simplement inertes (`isNativePlatform()` false → branche web).
- Une seule branche élimine le risque de divergence silencieuse (ex. un token modifié sur une branche et oublié sur l'autre) — risque réel vu le nombre de fichiers design à garder synchronisés listé ci-dessus.

Arguments de prudence :
- `android/` (79 fichiers) alourdirait `master`/`pwa` sans utilité pour un déploiement Vercel web pur — acceptable si le repo reste un mono-repo assumé, gênant si `master` doit rester un artefact web minimal pour d'autres raisons (CI, taille de clone).
- Le build web (`vite build`) et le build natif (`cap sync android`) resteraient deux commandes séparées de toute façon — l'unification de branche ne simplifie pas la chaîne de build, seulement la synchronisation du code source.

**Plan proposé (à valider, non exécuté dans ce lot)** : fusionner `feature/capacitor-mobile` dans `master` une fois Missions 2-3 stabilisées et testées sur device, en conservant `android/` versionné comme aujourd'hui ; supprimer la branche `pwa` séparée si elle n'a plus de code propre (à vérifier — hors périmètre de cartographie de ce lot, `pwa` n'a pas été auditée ici).

---

## Mission 5-11 — Refonte Home (2026-08-11)

### Checklist des points de contact (f), vérifiée un par un avant modification de `home.tsx`

Relecture complète de `home.tsx`, `use-daily-cycle.ts`, `use-home-badges.ts`, `use-nudge-arbitration.ts`, `use-anchor-defs.ts`, `use-soft-mode.ts`, `use-custom-intentions.ts`, `intentions.ts` avant toute édition. Pour chaque point de contact listé en (f) :

1. **Badges header** (`useHomeBadges` → `hasUnreadLetter`/`hasPendingCircleInvite`/`hasUnreadEncouragement`) — hook intact, signature inchangée. ✅ Conservé, re-stylé (pastille `bg-anchor-orange` au lieu de `bg-rose-accent`, cf. Mission 2).
2. **Modales globales** (`OnboardingModal`, `MorningRitual`, `GentleNudgeModal`, `StreakMilestoneModal`, `JarOpeningModal`, `MovePickerSheet`, `ConfettiBurst`) — props identiques relevées dans le code actuel. ✅ Montées à l'identique, aucune modification de leurs props.
3. **Companion** (`cycle.companionMsg`, `isSpeakingCompanion`, `handleToggleCompanionSpeech`, `isSpeechSynthesisAvailable`/`speak`/`stopSpeaking`) — état et handlers définis dans `HomePage` elle-même. ✅ Réutilisés tels quels, seulement ré-habillés dans la nouvelle carte Affirmation (Mission 6) — aucune nouvelle logique TTS.
4. **Slot de nudge unique** (`useNudgeArbitration`, priorité soft_exit > soft_enter > gratitude > push > wrapped_teaser) — hook intact. ✅ Conservé tel quel, seul l'habillage des cartes qu'il affiche change (elles sont dans des composants séparés déjà tokenisés).
5. **Move of the Day** (`MoveOfTheDayCard`, condition `featuredMoveTitle && !cycle.anchor.anchors_locked_at`) — logique de sélection (`move-selection.ts`) entièrement hors `home.tsx`. ✅ Condition et props inchangées.
6. **Barre de progression + Grace gift** (`cycle.graceGift`, `graceGiftSenderName` via `getMemberNames()`) — effect dans `HomePage`. ✅ Conservé, re-stylé avec tokens.
7. **Streaks** (`StreakCard` ×2, bascule de layout à `MIN_STREAK_FOR_INTENTION`) — composant local à `home.tsx`. ✅ Conservé, re-stylé (couleurs `activeBg`/`activeText`/`celebratedBg` passées en tokens `anchor-*`).
8. **Sélecteur de mood** (`moodConfig.map`, `cycle.handleMoodSelect`) — vérification clé : la règle métier « 1 mood/jour, modifiable jusqu'au soir » est déjà implémentée entièrement dans `useDailyCycle.handleMoodSelect` (upsert Supabase `onConflict: "user_id,date"`, recalcul optimiste des streaks via `refreshStreaks`) — **aucune logique dans l'UI**. ✅ Remplacer l'emoji par une icône signature et re-styler est donc strictement visuel : zéro risque sur mood_logs/streaks tant que l'`onClick` continue d'appeler `cycle.handleMoodSelect(key)`.
9. **Intention Hero + intention partagée du Circle** (`buildSelectableIntentions`, `cycle.anchor.daily_intention`, `cycle.saveAnchor`, effect `sharedIntentionAppliedRef`) — l'effect de pré-remplissage one-shot vit directement dans `HomePage` (pas un hook séparé). ✅ Effect copié à l'identique dans le nouveau `home.tsx`, seule la carte autour change visuellement.
10. **3 cartes Anchors** (`useAnchorDefs`, `PlanningAnchorCard`/`TrackingAnchorCard`/`SoftAnchorPicker`, `canCheckAnchors`/`getTimeUntilAnchorCheck`, `Haptics.impact` dans `TrackingAnchorCard`) — le time-gate et les haptics sont internes à `TrackingAnchorCard`, pas touchés. ✅ Seul le champ `icon` (actuellement un emoji `string`) change de type pour accepter une icône `<AppIcon>` ; `useAnchorDefs` et `PlanningAnchorCard`/`TrackingAnchorCard` adaptés en conséquence, logique de complétion/déverrouillage intouchée.
11. **JournalCard, GratitudeDropCard** — composants sans props. ✅ Repositionnés dans la nouvelle rangée Quick Actions, aucun changement interne.
12. **Carte « message de soutien »** — explicitement listée en (f) comme point à ne pas retirer. ✅ Conservée et montée (re-stylée sobrement), placée après la carte Affirmation.
13. **SosWidget** — composant sans props. ✅ Conservé en pied de page, position inchangée.
14. **Soft Mode** (`useSoftMode` : `softModeActive`, `softExpanded`, `softCategory`, bascule 3-cartes ↔ `SoftAnchorPicker`, `SoftModeBadge`) — hook intact. ✅ Badge repositionné dans le nouveau header, bascule d'affichage anchors conservée à l'identique.
15. **CircleInviteNudge** — hors slot d'arbitrage, toujours monté. ✅ Conservé, position inchangée (juste après le header/nudges).

Aucune divergence trouvée entre le contrat (f) et le code actuel — la checklist ci-dessus a servi de base à la réécriture de `home.tsx` ci-dessous.

### Mission 1 (theme officiel) — implémentation

`.dark` dans `src/index.css` a été réécrit pour mapper la palette du guide sur les tokens sémantiques existants : `--background→#0F0F10`, `--card→#17171A` (Surface), `--popover/--secondary/--muted→#1F1F23` (Surface-2), `--accent/--border/--input→#2A2A31` (Gradient-Dark), `--primary→#A7C48C` (texte `#0F0F10` dessus), `--foreground→#F2D8B6`. Les alias de marque existants suivent la même famille : `--sage→#A7C48C`, `--rose-accent→#F48FB1`, `--lavender→#B78CFF`, `--peach→#E9B072`. `:root` (clair) applique la palette miroir validée par l'utilisateur (`#FAF8F4`/`#6E8A55`/`#B96A2C`/`#7C55D6`/`#C24E77`). `--mood-stressed` (dark) recalibré à `#C2705F`, une teinte propre non fournie par le guide, choisie dans la même famille chaude.

**Contrastes vérifiés** (formule de luminance relative WCAG) :
- `--foreground` sur `--background`/`--card` (dark) : ≈13:1 / ≈16:1 — bien au-delà d'AA.
- `--muted-foreground` (`#B5AC9C`, choisi pour ce lot) sur `--background`/`--card` (dark) : ≈8.5:1 / ≈8.0:1.
- `--primary` (`#A7C48C`) sur `--background` (dark) : ≈9.8:1 (déjà vérifié Mission 2 du lot précédent).
- `--primary` (`#6E8A55`) avec texte blanc (clair) : ≈3.87:1 — **sous le seuil AA texte normal (4.5:1), mais préexistant** (l'ancien `--primary` #7A8B6E/blanc était à ≈3.66:1) ; ce lot ne dégrade pas, il améliore légèrement. Signalé plutôt que corrigé silencieusement — un vrai correctif demanderait soit un `--primary` plus sombre (impact large sur toute l'app), soit un texte de bouton non-blanc, décision à trancher séparément.
- **Régression trouvée et corrigée** : la bannière de time-gate (`TrackingAnchorCard`, `bg-peach/90` + texte) utilisait `text-foreground dark:text-background` — avec le nouveau `--peach` (orange moyen dans les deux thèmes, pas un pastel clair comme avant), le texte `--foreground` sur fond clair tombait à ≈2.67:1. Corrigé en `text-background` uniforme (≈3.8:1 clair / ≈10:1 sombre) — meilleur compromis pour une teinte qui n'a plus de version pastel dédiée.

**Fichiers resynchronisés** : `src/components/theme-provider.tsx` (`THEME_COLORS`, même mapping léger→primary / sombre→background qu'avant, nouvelles valeurs), `capacitor.config.ts` (`SplashScreen.backgroundColor` → `#FAF8F4`).

**Non touchés, documenté (b)** : `src/lib/pdf/palette.ts`, `src/lib/wrapped-share.ts`, `src/lib/letter-share.ts` continuent de figer le rendu clair d'origine pour les exports/partages — comportement inchangé, décision explicitement hors périmètre.

**Vérification écran par écran** : effectuée par audit statique (recherche exhaustive de hex codés en dur — seuls les 4 fichiers déjà documentés en existent, confirmé par grep) et relecture systématique des classes consommées par chaque composant du Home et de ses dépendances directes. **Aucun rendu visuel interactif n'a été possible dans cet environnement** (pas de navigateur/simulateur disponible) — recommandation : vérifier visuellement sur device/émulateur avant merge, en particulier le contraste `--primary`/blanc en thème clair relevé ci-dessus.

### Missions 2-11 — Home : ce qui a changé

- **Greeting** (Mission 2) : `text-anchor-greeting` (Playfair Display, token Mission 2 précédent), sous-ligne tone-aware via 2 nouvelles clés i18n (`home.subtitle_direct`/`home.subtitle_poetic`, fallback `home.subtitle` pour `gentle`/non défini) — **décision explicite** : rendu statique (pas d'appel IA) pour un affichage instantané, contrairement au companion qui reste asynchrone. Emoji 🌻 retiré du greeting (simplification visuelle assumée, purement décoratif).
- **Intention Hero** (Mission 3) : nouveau composant `IntentionHeroCard` — état « posée » (affiche l'intention active + bouton discret « Modifier ») vs état « édition » (chips + CTA `home.intention_set_cta`, désactivé tant qu'aucune chip n'est choisie, flash de confirmation ~1.2s avec `Check` + `home.intention_saved`, haptics légères). Gradient sombre `surface→gradient-dark` en dark, `card→surface-2` (blanc→crème) en light — proposition retenue pour l'équivalent clair. Icône `intention` (étincelle, choix documenté Mission 3 précédent) à côté du label. Persistance et pré-remplissage Circle inchangés (`cycle.saveAnchor`/`cycle.anchor.daily_intention` toujours la source de vérité, la carte ne fait que refléter/écrire dessus).
- **Mood 1-tap** (Mission 4) : `src/lib/constants.ts` `moodConfig` — `emoji` remplacé par `icon` (nom d'icône signature). 5 nouvelles icônes signature (`mood-great/okay/meh/low/stressed`, visages en trait arrondi) enregistrées dans `<AppIcon>`. Reconsommé à l'identique dans `checkin.tsx` (mood du soir). **Règle métier vérifiée intacte** : `cycle.handleMoodSelect` (upsert `mood_logs` `onConflict user_id,date`) est appelé sans changement — remplacer l'emoji par une icône est strictement visuel, streaks non affectés. État sélectionné : anneau + glow `anchor-orange`.
- **3 Anchors colorées** (Mission 5) : `useAnchorDefs.ts` et les 3 sous-composants (`PlanningAnchorCard`/`TrackingAnchorCard`/`SoftAnchorPicker`) — `icon: string` (emoji) → `icon: AppIconSource`. Future = icône signature `anchor-mark` + `var(--anchor-green)`, Mind/Body = lucide `Brain` + `var(--anchor-pink)`, Life = lucide `Globe` + `var(--anchor-lavender)`. Bouton suggestions 💡 → `Lightbulb` + libellé. Time-gate (`canCheckAnchors`), haptics de coche et logique de complétion **non modifiés**.
- **Quick Actions + Affirmation** (Mission 6) : `JournalCard`/`GratitudeDropCard` enveloppées dans `grid grid-cols-2 gap-3` (`min-w-0` par colonne pour éviter qu'un contenu interne ne force la largeur) — **aucune modification de leur code interne**. Carte Companion restylée en carte horizontale compacte, mêmes état/handlers (`cycle.companionMsg`, TTS) ; fallback statique déjà géré par le code existant (`|| t("companion.default_message")`), rien à ajouter. Carte « message de soutien » conservée (contrat (f)), repositionnée après l'affirmation.
- **Réordonnancement** (Mission 6) : Greeting → Intention Hero → Mood → Anchors → Quick Actions → Affirmation → (CircleInviteNudge, slot de nudge arbitré, Move of the Day, barre de progression, streaks, grace gift — logique et props identiques, seule la position dans le JSX change) → SOS.
- **Finitions** (Mission 7) : boutons-icônes du header et CTA portés à `min-h-11`/`min-w-11` (44px) via classes additives (ne modifie pas `button.tsx`) ; CTA intention `min-h-12`/`rounded-anchor-card-lg` (48px/24px) ; haptics ajoutées sur la confirmation d'intention (mood et check anchor en avaient déjà) ; transitions `motion-safe:` sur les échelles de sélection (mood, anchors, chips) pour respecter `prefers-reduced-motion` sans dupliquer la détection ; `env(safe-area-inset-bottom)` ajouté à la tab bar et au bouton Pause flottant (`app-layout.tsx`) + `viewport-fit=cover` (`index.html`) — additif, sans effet sur la configuration actuelle (pas de `overlaysWebView` détecté), prêt si un mode edge-to-edge est activé plus tard ; doublons streaks 🔥/⚓ retirés (l'icône suffit) ; 🫙 restant dans `checkin.tsx` — **non traité** (hors fichiers de ce lot, seul le sélecteur de mood de `checkin.tsx` a été touché) ; lettres scellée/ouverte — **non traitées**, `letters.tsx`/`letter-future-*.tsx` ne font pas partie des fichiers modifiés par ce lot.

### Points de vigilance non résolus (à trancher par Ruth / à vérifier sur device)

1. Contraste `--primary`/texte blanc en thème clair (~3.87:1) — préexistant, non aggravé, mais toujours sous AA pour du texte normal.
2. Grille 2 colonnes Quick Actions à 390px : `JournalCard` en mode édition (compteur + micro + bouton Save sur une ligne) est calculée serrée (~125px de largeur utile) — `min-w-0` mitige le débordement mais n'a pas pu être vérifié visuellement.
3. `env(safe-area-inset-*)` ajouté défensivement mais non vérifié sur device réel (pas de simulateur disponible ici).
4. Choix étincelle vs feuille pour l'icône « intention » toujours en attente de validation Ruth (posé au lot précédent).

---

## Lot 3 — Propagation du design system (2026-08-12)

Ce lot étend le langage visuel du Home refondu (lot 2) au reste de l'app : Check-in, Move, Letters, Circle, Patterns, Settings, Wrapped, Jar, Pause, et un passage sur les écrans d'auth/onboarding. Règle absolue respectée partout : aucune donnée, hook, prop ou flux métier modifié — uniquement `className`, imports d'icônes, et dans un cas les tailles par défaut d'un composant partagé (`button.tsx`, justifié ci-dessous).

### Mission 1 — Contraste `--primary` clair

`--primary` (et ses alias `--ring`, `--chart-1`, `--sidebar-primary`, `--sidebar-ring`, `--sage`) assombris de `#6E8A55` à **`#5F7A4B`** dans `src/index.css` (`:root`). Contraste avec le texte blanc des boutons primaires : **≈4.80:1** (calculé via la formule de luminance relative WCAG), au-dessus du seuil AA (4.5:1) — contre ≈3.87:1 avant ce lot. Solution retenue : assombrissement direct plutôt que changer la couleur du texte des boutons, pour ne pas introduire une deuxième variante de bouton primaire et préserver l'identité visuelle (même teinte, juste 12% plus sombre). Appliqué globalement — tout bouton `variant="default"` de l'app en bénéficie automatiquement.

### Fix transverse — touch targets (`src/components/ui/button.tsx`)

Découverte en cours de route : les tailles `default` (36px), `lg` (40px) et `icon` (36px) du composant `Button` partagé étaient **toutes sous 44px**, pas seulement sur les écrans de ce lot — un problème app-wide. Plutôt que de patcher individuellement des dizaines de call sites, `default`/`lg`/`icon` ont reçu un plancher `min-h-11`/`min-h-12`/`min-h-11 min-w-11` directement dans `buttonVariants` (additif, ne retire aucune classe existante). `sm`/`xs`/`icon-sm`/`icon-xs` restent compacts intentionnellement (contextes denses : puces, listes d'actions secondaires) — cohérent avec l'exception WCAG 2.5.8 pour les cibles « inline » dans un groupe équivalent. Les `size="sm"` utilisés comme contrôle principal (ex. bouton d'envoi, accepter/refuser) ont reçu un `min-h-11` individuel là où c'était le cas.

### Récapitulatif par écran

**Check-in** (`checkin.tsx`) — cartes `rounded-anchor-card-lg` ; questions de réflexion en `font-heading` (Playfair) au lieu de `font-body` ; 🫙 → `<AppIcon icon="gratitude-jar">` ; touch targets boutons voix/chips/release bump. Points de contact vérifiés : `useCheckIn` (hook intact), `moodConfig` déjà migré au lot précédent (visages signature confirmés en place), `EveningReleaseAnimation` et soft mode (1 question) non touchés — seule la carte autour change.

**Move** (`move.tsx`, `move-picker-sheet.tsx`, `move-of-the-day-card.tsx`) — les 3 maps d'emoji de catégorie dupliquées (🌳🪑💌🎧🎨🛌) centralisées dans un nouveau fichier `src/lib/move-category-icons.ts` (Trees/Armchair/Mail/Headphones/Palette/BedDouble, Lucide), consommé par les 3 fichiers. Icônes anchor-category (🌱🧠🌍) alignées sur les mêmes choix que `useAnchorDefs.ts` (anchor-mark/Brain/Globe). `move-selection.ts` et toute la logique de sélection/corrélation **non touchés** — vérifié composant par composant (props purement présentationnelles pour `MovePickerSheet`/`MoveOfTheDayCard`, confirmé par leurs propres commentaires de code).

**Letters** (`letters.tsx`, `letter-detail.tsx`, `letter-future-write.tsx`, `letter-future-detail.tsx`) — 💌 remplacé partout par `LetterSealedIcon`/`LetterOpenIcon` selon l'état réel (scellée vs prête à ouvrir vs rituel d'ouverture) ; carte « prête à ouvrir » recolorée `bg-anchor-orange/15` (accent d'événement demandé) ; surfaces de lecture premium (`letter-detail.tsx`, `letter-future-detail.tsx`) passées de `rounded-3xl` à `rounded-anchor-card-lg` (même valeur, token) avec gradient `anchor-soft-green`/`anchor-lavender`. Points de contact vérifiés et **non touchés** : `isDue()` (règle « jamais de contenu avant échéance »), le rituel plein écran (`RitualState` state machine dans `letter-future-detail.tsx`, seules les classes de son conteneur ont changé), le write-back (`opened_at`, `shared_with_circle`), le cron (`reminder_sent_at`, hors de ces 4 fichiers).

**Circle** (`circle.tsx`) — les deux 🌱 (ligne ~585 anniversaire → `CircleOfTrustIcon`, ligne ~730 proposer une intention → `IntentionIcon`, sémantiquement plus juste que réutiliser la même icône aux deux endroits). Bug de contraste du bouton d'enregistrement vocal **confirmé toujours présent** (`text-white dark:text-background` sur `bg-rose-accent`) et corrigé en `text-background` uniforme. Cartes (SOS, anniversaires, milestones, intention partagée, grace gift, membres, lettres partagées, feed) : tokens `anchor-*` + `rounded-anchor-card-lg`. Points de contact vérifiés et non touchés : les ~12 fonctions de `src/lib/circle-*.ts` listées dans le rapport de recherche, `HeartHandshake` (SOS, non modifié), `VoicePlayerInline`/`VoiceComposeForm` (logique de lecture/enregistrement intacte).

**Mission 6 — Patterns/Settings/Wrapped/Jar/Pause** :
- **Pause** (`pause-modal.tsx`) : 🧘🌬️🌱💬 → icône `pause` signature (header) + Lucide `Wind`/`Target`/`Compass` (les 3 options).
- **Jar** — migration `JarIcon` (64×64) → `<AppIcon icon="gratitude-jar">` (24×24) dans `gratitude-drop-card.tsx`, `gratitude-reminder-card.tsx`, `jar.tsx` (icônes inline à côté de texte, h-4/h-6). **`jar-opening-modal.tsx` volontairement non touché** : ses 3 usages de `JarIcon` (dont un `h-10 w-10` autonome au moment de la révélation) restent le grand jar illustratif — c'est le moment le plus chargé émotionnellement de la feature (ouverture du bocal), la grande illustration détaillée y a plus de sens qu'une icône signature 24×24 conçue pour un contexte inline. 🫙 résiduel de `gratitude-drop-card.tsx` (animation de dépôt) également remplacé.
- **Wrapped/Wrapped-history** — `wrapped.tsx` : boutons (fermer, partager, retour) portés à 44/48px, radius token ; **le rendu canvas (`wrapped-share.ts`) non touché**, confirmé par le rapport de recherche que ce fichier n'est jamais importé dans `wrapped-history.tsx` et n'intervient dans `wrapped.tsx` qu'au clic sur « partager » (`shareWrappedCard`). `wrapped-history.tsx` : radius pass uniquement (pas de canvas ici).
- **Settings** — radius pass, toggle de langue et bouton « save » portés à 44px. Aucun emoji trouvé (confirmé par l'audit).
- **Patterns** — radius pass uniquement : les graphiques recharts étaient **déjà 100% pilotés par tokens** (`var(--chart-1..5)`, `var(--muted-foreground)`, `var(--card)`, la map `moodColors` vers `var(--peach/sage-light/lavender/rose-accent/mood-stressed)`), confirmé par le rapport de recherche — rien à corriger pour la lisibilité en sombre. La map décorative `insightIcons` (☀️🌙🌿✨, badges d'insight) laissée telle quelle : flourish décoratif à côté de texte traduit, pas un concept structurel nommé dans le périmètre de ce lot.

**Mission 7 — Audit final** : passage `grep` exhaustif sur tout `src/**/*.tsx` pour les emoji restants (entités `&#x1F...;`/`&#x2...;` et Unicode brut). Trouvé et corrigé : `streak-milestone-modal.tsx` (⚓ → `AnchorMarkIcon` signature, moment de célébration). Trouvés et **laissés tels quels** (flourish décoratif accolé à du texte déjà traduit, pas un indicateur d'état/catégorie) : 🌸/🎁/✨/☁️ dans `home.tsx`/`checkin.tsx`, tableau mood du mock téléphone dans `hero-section.tsx` (page marketing publique, hors design system in-app). Audit des pages auth/onboarding (`login.tsx`, `register.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `onboarding-modal.tsx`) : aucun emoji, aucune couleur codée en dur, aucun touch target sous 44px trouvé indépendamment du fix `button.tsx` — seul point relevé et corrigé : les 5 usages du logo Lucide `Anchor` générique migrés vers l'icône signature `anchor-mark`.

### Fichiers modifiés (ce lot uniquement)

`src/index.css`, `src/components/ui/button.tsx`, `src/lib/move-category-icons.ts` (nouveau), `src/hooks/use-anchor-defs.ts`, `src/pages/checkin.tsx`, `src/pages/move.tsx`, `src/components/anchor/move-picker-sheet.tsx`, `src/components/anchor/move-of-the-day-card.tsx`, `src/pages/letters.tsx`, `src/pages/letter-detail.tsx`, `src/pages/letter-future-write.tsx`, `src/pages/letter-future-detail.tsx`, `src/pages/circle.tsx`, `src/components/anchor/pause-modal.tsx`, `src/components/anchor/gratitude-drop-card.tsx`, `src/components/anchor/gratitude-reminder-card.tsx`, `src/pages/jar.tsx`, `src/pages/settings.tsx`, `src/pages/wrapped.tsx`, `src/pages/wrapped-history.tsx`, `src/pages/patterns.tsx`, `src/components/anchor/streak-milestone-modal.tsx`, `src/pages/login.tsx`, `src/pages/register.tsx`, `src/pages/forgot-password.tsx`, `src/pages/reset-password.tsx`, `src/components/onboarding/onboarding-modal.tsx`.

Non modifiés (vérifié explicitement, hors périmètre) : `src/lib/wrapped-share.ts`, `src/lib/letter-share.ts`, `src/lib/pdf/palette.ts`, `src/components/anchor/jar-opening-modal.tsx`, `src/components/ui/empty-state.tsx`, toute logique dans `src/lib/*` et `src/hooks/*` (hors le champ `icon` de `use-anchor-defs.ts`).

### Vérifications de fin de lot

- `npm run typecheck` → aucune erreur.
- `npm run build` → succès.
- `npm run check-i18n` → 698 clés (inchangé — aucune nouvelle chaîne introduite dans ce lot, uniquement de l'habillage).
- `npm run check-duplicates` → paires de logique dupliquée toujours comportementalement identiques.
- Vérification visuelle écran par écran (clair/sombre, device réel) : **non effectuée**, toujours pas de navigateur/simulateur disponible dans cet environnement — audit statique uniquement (lecture systématique + grep). Recommandation inchangée : vérifier sur device avant merge, en particulier les nouveaux fonds `bg-anchor-orange/15` (lettres prêtes à ouvrir) et `bg-anchor-lavender/anchor-orange` (cartes SOS/milestone) en clair ET sombre.

---

## Journal des changements

*(mis à jour à la fin de chaque mission, fichier par fichier)*

- **Mission 1** (2026-08-11) : création de `CARTOGRAPHIE.md`. Aucun autre fichier modifié.

- **Mission 2** (2026-08-11), branche `feature/capacitor-mobile` :
  - `src/index.css` — ajout additif uniquement (décision utilisateur : pas de bascule de `.dark`, pas d'application de la palette claire miroir). Nouveaux tokens bruts dans `:root` (`--anchor-background`, `--anchor-surface`, `--anchor-surface-2`, `--anchor-gradient-dark`, `--anchor-green`, `--anchor-warm-cream`, `--anchor-orange`, `--anchor-lavender`, `--anchor-pink`, `--anchor-soft-green`, échelle d'espacement `--anchor-space-1..7`, rayons `--anchor-radius-*`, typographie `--anchor-text-*`), et leur enregistrement dans `@theme inline` (`--color-anchor-*`, `--spacing-anchor-*`, `--radius-anchor-*`, `--text-anchor-*`) pour générer les utilitaires Tailwind (`bg-anchor-green`, `rounded-anchor-card-lg`, `p-anchor-3`, `text-anchor-greeting`, etc.). **`--background`, `--primary`, `.dark` et tout le reste des tokens existants sont inchangés** — zéro impact visuel sur l'app actuelle, vérifié par build complet.

- **Mission 3** (2026-08-11), branche `feature/capacitor-mobile` :
  - **Nouveaux fichiers** : `src/components/icons/signature/signature-svg.tsx`, `anchor-mark.tsx`, `gratitude-jar.tsx`, `letter-sealed.tsx`, `letter-open.tsx`, `circle-of-trust.tsx`, `intention.tsx`, `mood.tsx`, `move.tsx`, `pause.tsx`, `index.ts` ; `src/components/icons/app-icon.tsx`.
  - `src/pages/app-layout.tsx` — bottom nav et bouton Pause migrés vers `<AppIcon>` (voir détail Mission 3 ci-dessus). Import ajouté : `usePrefersReducedMotion` (hook existant, réutilisé), `AppIcon`. Taille des icônes de nav explicitement fixée à `20` pour préserver le rendu actuel (`h-5 w-5` d'origine).
  - Aucun autre fichier modifié — en particulier **`src/pages/home.tsx` n'a pas été touché**, ni `src/lib/constants.ts`, ni `src/components/anchor/jar-icon.tsx`.

### Vérifications de fin de lot (Mission 3, fondation)

- `npm run typecheck` → aucune erreur.
- `npm run build` → succès (le warning « chunks > 500kB » est préexistant, sans rapport avec ce lot).
- Aucun fichier d'écran (`src/pages/home.tsx` et les autres pages du cycle quotidien) n'a été modifié, hors `src/pages/app-layout.tsx` (chrome de nav, explicitement dans le périmètre « au moins la bottom nav » des critères d'acceptation).
- i18n : aucune nouvelle chaîne introduite (les `aria-label` réutilisent des clés `t()` existantes), donc rien à ajouter dans `en.json`/`sw.json`.

- **Missions 5-11 — Refonte Home** (2026-08-12), branche `feature/capacitor-mobile` :
  - `src/index.css` — `.dark` réécrit intégralement (palette officielle du guide) ; `:root` réécrit intégralement (palette claire miroir validée). Bloc `--anchor-*` (Mission 2 précédent) inchangé.
  - `src/components/theme-provider.tsx` — `THEME_COLORS` resynchronisé.
  - `capacitor.config.ts` — `SplashScreen.backgroundColor` resynchronisé.
  - `index.html` — `viewport-fit=cover` ajouté au meta viewport.
  - `src/pages/app-layout.tsx` — `env(safe-area-inset-bottom)` ajouté à la tab bar et au bouton Pause flottant.
  - `src/lib/constants.ts` — `moodConfig` : champ `emoji` → `icon` (nom d'icône signature).
  - `src/pages/checkin.tsx` — sélecteur de mood du soir migré vers `<AppIcon>`, import `moodConfig` adapté au nouveau champ `icon`.
  - `src/hooks/use-anchor-defs.ts` — `AnchorDef.icon` : `string` (emoji) → `AppIconSource` ; valeurs Future/Mind-Body/Life → icône signature `anchor-mark` / lucide `Brain` / lucide `Globe` ; `borderColor` → tokens `var(--anchor-green/pink/lavender)`.
  - `src/pages/home.tsx` — réécriture complète de la hiérarchie visuelle (voir détail ci-dessus) ; logique métier, hooks, effects et props des composants enfants strictement préservés (checklist des points de contact ci-dessus).
  - **Nouveaux fichiers icônes** : `src/components/icons/signature/mood-great.tsx`, `mood-okay.tsx`, `mood-meh.tsx`, `mood-low.tsx`, `mood-stressed.tsx` ; `signature/index.ts` et `app-icon.tsx` mis à jour (registre + export du type `AppIconSource` + support `style`) ; `signature/signature-svg.tsx` mis à jour (support `style`).
  - `src/locales/en.json` et `src/locales/sw.json` — 7 nouvelles clés sous `home.*` (`subtitle_direct`, `subtitle_poetic`, `intention_hero_prompt`, `intention_set_cta`, `intention_saved`, `intention_change`, `quick_actions_title`).
  - Aucun autre fichier modifié — en particulier `src/lib/pdf/palette.ts`, `wrapped-share.ts`, `letter-share.ts`, `src/pages/letters.tsx`, `letter-future-*.tsx`, `move.tsx`, `circle.tsx` **non touchés** (hors périmètre de ce lot, cf. backlog Mission 3 du lot précédent).

### Vérifications de fin de lot (Missions 5-11)

- `npm run typecheck` → aucune erreur.
- `npm run build` → succès.
- `npm run check-i18n` → 698 clés, EN/SW synchronisés, toutes les clés statiques utilisées existent.
- `npm run check-duplicates` → toutes les paires de logique dupliquée restent comportementalement identiques.
- Checklist des 15 points de contact (f) : revue un par un avant modification, tous confirmés préservés après réécriture (relecture complète du fichier final).
- Vérification visuelle écran par écran (clair/sombre, device réel) : **non effectuée** — aucun navigateur/simulateur disponible dans cet environnement. Points de vigilance listés ci-dessus à vérifier avant merge.

- **Lot 3 — Propagation du design system** (2026-08-12) : détail complet, écran par écran, dans la section « Lot 3 » ci-dessus. Résumé : fix contraste `--primary` clair (≈4.80:1), fix touch targets transverse (`button.tsx`), Check-in/Move/Letters/Circle/Pause/Jar/Wrapped/Settings/Patterns/Auth alignés sur les tokens et `<AppIcon>` du Home refondu, zéro emoji-icône structurel résiduel dans les 6 domaines ciblés (mood, Move, lettres, Circle, Pause, jar).
