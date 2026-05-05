const pools = {
  en: [
    "What are you grateful for today?",
    "What felt heavy today?",
    "Where did your body find rest today?",
    "What asked for your attention today?",
    "What made you smile today?",
    "What are you ready to leave behind tonight?",
    "Where did you find peace today?",
    "What surprised you today?",
    "What did you do gently today?",
    "What are you proud of today?",
    "What did you learn about yourself today?",
    "What do you need more of tomorrow?",
    "What felt like a small victory today?",
    "What are you holding too tightly?",
  ],
  sw: [
    "Una shukuru nini leo?",
    "Nini kilikuwa kizito leo?",
    "Mwili wako uliipata wapi raha leo?",
    "Nini kilikihitaji umakini wako leo?",
    "Nini kilikufanya ucheka leo?",
    "Nini uko tayari kuacha nyuma usiku huu?",
    "Uliipata wapi amani leo?",
    "Nini kilikushangaza leo?",
    "Nini ulichofanya kwa upole leo?",
    "Nini unajivunia leo?",
    "Nini ulijifunza kuhusu wewe mwenyewe leo?",
    "Unahitaji zaidi ya nini kesho?",
    "Nini kiliona kama ushindi mdogo leo?",
    "Nini unashikilia sana?",
  ],
}

export function getDailyQuestions(
  userId: string,
  date: string,
  lang: "en" | "sw" = "en"
): [string, string] {
  const pool = pools[lang] || pools.en

  // Seed déterministe basé sur userId + date
  let seed = 0
  const str = userId + date
  for (let i = 0; i < str.length; i++) {
    seed = ((seed << 5) - seed) + str.charCodeAt(i)
    seed |= 0
  }

  // Fisher-Yates shuffle déterministe
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = Math.abs((seed * 16807) % 2147483647)
    const j = seed % (i + 1)
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  return [shuffled[0], shuffled[1]]
}