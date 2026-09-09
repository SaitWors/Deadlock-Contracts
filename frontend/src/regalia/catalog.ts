import type { IconName } from "../icons/Icon"

// Stable reward/symbol IDs, now mapped to licensed SVG geometry.
export const REGALIA = {
  "medal-first": { icon: "file-text", label: "Первое дело" },
  "medal-shadow": { icon: "shield-check", label: "Сложные контракты" },
  "medal-team": { icon: "shuffle", label: "Три режима" },
  "medal-danger": { icon: "swords", label: "Экстремальный контракт" },
  "medal-consistent": { icon: "repeat", label: "Постоянство" },
  "medal-support": { icon: "heart-pulse", label: "Поддержка" },
  "medal-flawless": { icon: "target", label: "Точность" },
  "medal-versatile": { icon: "layers", label: "Категории" },
  "medal-archive": { icon: "archive", label: "Архив" },
  "medal-witness": { icon: "users", label: "Свидетели" },
  "medal-common": { icon: "handshake", label: "Общее дело" },
  "medal-last": { icon: "gem", label: "Редкие контракты" },
  "seal-compass": { icon: "compass", label: "Компас" },
  "seal-adapt": { icon: "shuffle", label: "Хамелеон" },
  "seal-archive": { icon: "file-text", label: "Документы" },
  "seal-witness": { icon: "eye", label: "Сыщики" },
  "seal-team": { icon: "handshake", label: "Руки" },
  "seal-time": { icon: "hourglass", label: "Часы" },
  "seal-justice": { icon: "scale", label: "Правосудие" },
  "seal-secret": { icon: "book-open", label: "Тайное знание" },
  "seal-support": { icon: "heart-handshake", label: "Поддержка" },
  "seal-end": { icon: "feather", label: "Новая глава" },
  "seal-night": { icon: "moon", label: "Ночь" },
  "seal-flight": { icon: "building-2", label: "Общий город" },
  "seal-ornate-compass": { icon: "compass", label: "Парадный компас" },
  "seal-crown": { icon: "crown", label: "Коронованный глаз" },
  "seal-book": { icon: "book-open", label: "Книга архива" },
  "seal-city": { icon: "building-2", label: "Город" },
  "seal-ornate-team": { icon: "users", label: "Круг бюро" },
  "seal-ornate-time": { icon: "hourglass", label: "Песочные часы" },
} as const satisfies Record<string, { icon: IconName; label: string }>
export type RegaliaId = keyof typeof REGALIA

// Cosmetic mapping only. Earned state and conditions always come from the API.
export const ACHIEVEMENT_ART: Record<string, RegaliaId> = {
  first_case: "medal-first",
  ten_cases: "medal-consistent",
  fifty_cases: "medal-archive",
  hard_cases: "medal-shadow",
  extreme_case: "medal-danger",
  rare_cases: "medal-last",
  three_modes: "medal-team",
  four_categories: "medal-versatile",
  team_city_cases: "medal-common",
  team_field_hospital: "medal-support",
  team_five_witnesses: "medal-witness",
}
export const CIPHER_ART: RegaliaId[] = [
  "seal-compass",
  "seal-adapt",
  "seal-archive",
  "seal-witness",
  "seal-team",
  "seal-time",
]
