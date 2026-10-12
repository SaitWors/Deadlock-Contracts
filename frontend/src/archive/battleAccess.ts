export const accessReason = (reason: string, ru: boolean) =>
  ({
    ACCOUNT_AGE: ru ? "Аккаунту нужно 7 дней" : "Account must be 7 days old",
    ACCOUNT_TOO_NEW: ru ? "Аккаунту нужно 7 дней" : "Account must be 7 days old",
    CONTRACTS_OR_PVE: ru
      ? "20 проверенных контрактов или 15 наградных PvE-побед"
      : "20 verified contracts or 15 reward-eligible PvE wins",
    PROGRESS_REQUIRED: ru
      ? "20 проверенных контрактов или 15 наградных PvE-побед"
      : "20 verified contracts or 15 reward-eligible PvE wins",
    TRIAL_REQUIRED: ru ? "Победите в испытании этого покровителя" : "Win this patron's trial",
    TRIAL: ru ? "Победите в испытании этого покровителя" : "Win this patron's trial",
    PATRON_TRIAL: ru ? "Победите в испытании этого покровителя" : "Win this patron's trial",
    BATTLE_APPROVAL: ru ? "Боевой вариант ещё не одобрен" : "Battle definition is not approved yet",
    NOT_OWNED: ru ? "Приобретите базу за 1800 монет" : "Acquire this base for 1800 coins",
  })[reason] || reason
