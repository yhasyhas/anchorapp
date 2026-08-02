const pools = {
  en: [
    "What's one thing from your day?",
    "One sentence is enough. What stood out today?",
    "What moment is worth keeping today?",
    "What would you want to remember about today?",
    "What's the one thing you'd tell a friend about today?",
    "What quietly mattered today?",
  ],
  sw: [
    "Ni jambo gani moja kutoka siku yako?",
    "Sentensi moja inatosha. Ni nini kilichojitokeza leo?",
    "Ni wakati gani unaostahili kukumbukwa leo?",
    "Ungependa kukumbuka nini kuhusu leo?",
    "Ni jambo gani moja ungemwambia rafiki kuhusu leo?",
    "Ni nini kilichokuwa muhimu kimya kimya leo?",
  ],
}

export function getDailyJournalQuestion(
  userId: string,
  date: string,
  lang: "en" | "sw" = "en"
): string {
  const pool = pools[lang] || pools.en

  // Seed déterministe basé sur userId + date (même pattern que checkin-questions.ts,
  // suffixe "journal" pour ne pas tirer le même index que les questions de check-in)
  let seed = 0
  const str = userId + date + "journal"
  for (let i = 0; i < str.length; i++) {
    seed = ((seed << 5) - seed) + str.charCodeAt(i)
    seed |= 0
  }

  return pool[Math.abs(seed) % pool.length]
}
