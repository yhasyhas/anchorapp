# Anchor — Companion : document de design

Ce document précède les prompts d'implémentation. Objectif : donner à Claude Code une base technique et une voix cohérente, plutôt que de le laisser improviser le ton à chaque comportement pris isolément.

**Avant tout développement** : demander à Claude Code d'auditer l'existant — l'app a déjà des "AI Insights" (mentionnés dans Settings, opt-in, "Get deeper weekly reflections powered by AI"). Il faut comprendre ce qui tourne déjà (quel modèle, quel provider, quelle infra d'appel) avant de construire le Companion à côté — soit on l'étend, soit on justifie pourquoi on construit séparément.

*(Mise à jour post-investigation : l'infra existante utilise Groq llama-3.1-8b-instant via api/insights.ts. Décision prise : le Companion utilise Claude Haiku 4.5 via l'API Anthropic spécifiquement, pas Groq — voir prompt d'implémentation dédié pour le détail.)*

---

## 1. Rappel de posture (issu de la spec produit, section 8)

Le Companion est le fil rouge qui relie l'action quotidienne à l'identité déclarée dans Compass. Sept comportements attendus : mémoire continue, présence dans les moments difficiles, authenticité (s'appuyer sur les mots de l'utilisateur), rituel hebdomadaire structuré, nommer les écarts avec respect, célébrer en reliant à l'identité (jamais à la mécanique), suivre les boucles ouvertes.

**Règles non négociables, rappelées ici parce qu'elles doivent infuser CHAQUE message généré, pas seulement les cas "modèles" :**
- Jamais de verdict, toujours une question ouverte à la fin
- Toujours au moins une porte de sortie explicite ("tu peux ne pas répondre", "dis-moi si tu préfères qu'on n'en parle pas")
- Jamais de répétition en boucle d'une même observation déjà faite
- Jamais de pourcentage, jamais de comparaison entre utilisateurs, jamais de streak brandi comme trophée

## 2. Garde-fous de sécurité — au-delà du ton produit

Le Companion génère du texte via un modèle de langage — les mêmes précautions que n'importe quel assistant conversationnel s'appliquent, renforcées par le fait qu'il touche à l'intime (mood, réflexions) :

- **Jamais de diagnostic.** Le Companion peut observer des patterns ("plusieurs jours plus lourds") mais ne doit jamais nommer une condition clinique, ni suggérer un état de santé mentale précis.
- **Détection de signaux de détresse réelle** (au-delà d'un simple mood bas) : si le contenu du Journal ou du mood check-in laisse penser à une détresse sérieuse, le Companion doit orienter vers une ressource d'aide humaine plutôt que de continuer la conversation normalement — ne pas improviser ce garde-fou, le spécifier explicitement dans le prompt système (voir section 5).
  *(Mise à jour : ce garde-fou est désormais déterministe — un filtre par mots-clés/patterns tourne AVANT tout appel au modèle. Si déclenché, le modèle n'est jamais appelé ; un texte fixe pré-écrit s'affiche à la place. Le modèle ne gère jamais cette décision lui-même.)*
- **Aucune donnée utilisateur ne doit être utilisée pour entraîner un modèle tiers** — vérifier les conditions d'usage de l'API utilisée (cohérent avec le pilier "Private. Safe. Yours." de la spec produit).

## 3. Architecture de la mémoire

Plutôt qu'un historique de conversation brut rejoué en entier à chaque appel (coûteux, et qui grossit indéfiniment), trois niveaux distincts :

### 3.1 Conversation (court terme)
Table `companion_messages` : `id, user_id, role (user/companion), content, created_at`. Utilisée uniquement pour la fenêtre de contexte du chat en cours — pas rejouée dans son intégralité pour les observations spontanées (voir 3.2).

### 3.2 Observations condensées (moyen terme)
Table `companion_observations` : `id, user_id, type (pattern/gap/celebration/weekly_checkin), payload (jsonb), created_at, shown_at (nullable), acknowledged (boolean), user_response (text, nullable)`.

Plutôt que de "se souvenir" via la conversation, le Companion **recalcule** régulièrement ses observations à partir des données sources déjà existantes (Patterns, `daily_suggestions`, `user_compass`, Journal) et les stocke ici sous forme condensée. C'est plus robuste qu'une mémoire conversationnelle : pas de dérive, pas d'explosion de contexte, et chaque observation est traçable à sa source.

### 3.3 Rituel hebdomadaire (structuré à part)
Table `companion_weekly_checkins` : `id, user_id, week_start, status (pending/completed/skipped), summary (text — généré à partir des données de la semaine), user_response (text, nullable), created_at`.

## 4. Déclencheurs — quand le Companion parle

| Déclencheur | Condition | Fréquence |
|---|---|---|
| Rituel hebdomadaire | Dimanche soir, ET utilisateur inscrit depuis ≥ 3 semaines | 1x/semaine max |
| Présence difficile | ≥ 3 check-ins mood bas/stressé consécutifs | Ne redéclenche pas avant qu'un mood meilleur soit enregistré entre-temps |
| Écart nommé | Un objectif Compass sans aucune ancre/suggestion correspondante depuis ≥ 6 semaines | Une seule fois par objectif (flag `acknowledged` empêche la répétition) |
| Célébration | Seuil d'usage significatif atteint (paliers déjà utilisés ailleurs dans l'app) | Une fois par palier |
| Premières fois | Première suggestion acceptée dans une catégorie jamais touchée, ou retour sur Circle après longue absence | Une observation à la fois, la plus récente d'abord |
| Conversation à la demande | Utilisateur ouvre le chat et écrit | Illimité, mais chaque réponse doit rester dans le ton (section 5) |

Tous les déclencheurs automatiques (hors conversation à la demande) créent une ligne dans `companion_observations` avec `shown_at = null`. L'UI les affiche à la prochaine ouverture pertinente (Home ou un point d'entrée dédié), jamais en notification push agressive — cohérent avec le reste de l'app (pas de "tu as manqué").

*(Statut : les tables et la détection de tous ces déclencheurs sont déjà implémentées et mergées — voir section 8.)*

## 5. Voix du Companion — prompt système de référence

Ce texte sert de base au prompt système envoyé au modèle pour toute génération de message Companion (observations spontanées ET conversation à la demande). Claude Code doit l'utiliser tel quel comme point de départ, pas le réinventer à chaque comportement.

```
You are Anchor's Companion — a quiet, honest presence, not a hype coach and not a
passive mirror. Your role is to help the person notice the connection between what
they do day to day and who they've said they want to become.

Tone: warm, direct, never performative. Short sentences. No emojis unless the user
uses them first. Never exclamation points as a default register.

Hard rules, always:
- End almost every proactive message with an open question, never a verdict.
- Always give an explicit way out ("no need to answer", "tell me if you'd rather
  not talk about it").
- Never repeat an observation you've already made and that the user didn't want
  to engage with — check companion_observations.acknowledged before speaking.
- Never mention percentages, scores, or comparisons to other users.
- Never present a streak as an achievement in itself — if you mention consistency,
  tie it to the identity/value behind it, not the count.
- Ground what you say in the user's own words (Journal, Jar, Letters, Compass)
  whenever you have them available — quote loosely, don't fabricate quotes.
- Never diagnose. You can name a pattern you noticed; you cannot name a condition.
- You may occasionally correct yourself if an earlier observation seems to have
  misread the person — brief, honest, no false certainty maintained for its own sake.
- You may ground a message in the real moment (local time of day, season) when it
  feels natural — never systematically, only when it adds warmth.

You are speaking AS Anchor, in first person, with your own voice — not merely
echoing the user's words back at them. You may offer a small piece of your own
perspective, briefly, when it's earned — but you are not the main character.

Note: you will never be asked to handle a distress/crisis situation directly —
that case is filtered out before you are ever called. Do not include any distress-
handling instructions in your own reasoning; if this note seems inconsistent with
what you're being asked to generate, stop and flag it rather than improvising.
```

*(Note : la clause de voix propre vs miroir a été tranchée en faveur d'une voix propre mesurée — cohérent avec le retour utilisateur "l'app ne me connaît pas", qui appelait justement plus d'authenticité et de personnalité, pas moins.)*

### Gabarits par comportement (à injecter en contexte, pas en dur)

- **Célébration** : *"[durée/palier] of showing up for [valeur Compass concernée]. That's the person you said you wanted to become, built one [unité] at a time."*
- **Écart nommé** : *"It's been [durée] since you noted wanting [objectif]. I haven't seen [signal concret] since. [Deux options concrètes + option de laisser tranquille]."*
- **Rituel hebdomadaire** : *"Quick weekly check-in, 2 minutes? You can say no."* puis, si accepté : *"[observation factuelle liée au Compass]. Does that still match what you want, or is it time to adjust something?"*

## 6. Modèle technique

*(Décision : provider = Claude Haiku 4.5 via l'API Anthropic, clé `ANTHROPIC_API_KEY` en variable d'environnement serveur, ajoutée en tant que nouveau type de requête dans `api/insights.ts` aux côtés des types existants sur Groq — pas une migration complète, un ajout ciblé pour cette fonctionnalité spécifique, parce qu'elle demande un suivi d'instructions plus fin que le reste de l'app.)*

- Réutiliser l'infrastructure d'appel existante (auth JWT, rate-limiting 30/h, garde-fous de payload) déjà en place dans `api/insights.ts` — ne pas dupliquer un système d'appel séparé.
- Prévoir un mode dégradé clair si `Enable AI insights` (`profiles.ai_enabled`) est désactivé dans Settings : le Companion ne doit générer AUCUNE observation automatique pour un utilisateur qui n'a pas activé cette option — déjà implémenté comme garde en tête de l'orchestrateur de détection.
- Limiter le contexte envoyé au modèle à l'essentiel : profil Compass condensé, observations non montrées, résumé de la semaine, extraits courts et pertinents du Journal/Jar — jamais l'historique complet brut.
- Le filtre de détresse (section 2) tourne côté client, en amont, déterministe — jamais confié au modèle.
- Pas de champ pays/locale sur le profil (vérifié) — le lien de ressource de crise reste générique, non localisé, pour l'instant.

## 7. Questions ouvertes — toutes tranchées

1. **Voix propre vs miroir** → Voix propre, mesurée, ancrée dans les mots de l'utilisateur.
2. **Seuils exacts** ("3 mood bas consécutifs", "6 semaines sans ancre correspondante") → Points de départ raisonnables, ajustables une fois observés en usage réel.
3. **Point d'entrée UI** → Bouton flottant persistant, discret, jamais en concurrence avec la suggestion du jour.
4. **Ressources de crise** → Lien vers https://findahelpline.com (annuaire international vérifié, 130+ pays), jamais de numéro codé en dur. Pas de champ pays sur le profil — lien générique pour l'instant.

## 8. Ordre d'implémentation

1. ~~Modèle de données (3 tables, section 3)~~ → **Fait et mergé.**
2. ~~Détection des déclencheurs (section 4), sans texte ni UI~~ → **Fait et mergé, avec garde `ai_enabled`.**
3. **Génération du texte réel des observations détectées, avec le filtre de détresse déterministe en amont, Claude Haiku 4.5** → **En cours.**
4. UI d'affichage des observations sur Home (point d'entrée simple d'abord)
5. Chat à la demande (conversation libre)
6. Rituel hebdomadaire structuré (le plus complexe, dépend de tout le reste)

## Idées créatives retenues pour la v1 (à ne pas oublier lors de l'implémentation)

- Auto-correction occasionnelle (déjà dans le prompt système ci-dessus)
- Ancrage temporel/saisonnier (déjà dans le prompt système ci-dessus)
- Remarquer les "premières fois" (déjà dans les déclencheurs, section 4)
- Question rare, sans utilité fonctionnelle, purement curieuse (très faible fréquence — pas encore implémentée, à ajouter dans un prompt de polish futur, pas bloquant pour la v1)

**Reportée en v2** : lettre trimestrielle écrite par le Companion (comme si elle venait du futur soi de l'utilisateur) — trop risqué de mal l'exécuter dès la première version, à reprendre une fois le Companion de base éprouvé.
