import signal from "@/imports/regalia/medals-signal.webp"
import bureau from "@/imports/regalia/medals-bureau.webp"
import latin from "@/imports/regalia/seals-latin.webp"
import ornate from "@/imports/regalia/seals-ornate.webp"
import classic from "@/imports/regalia/seals-classic.webp"
import first from "@/imports/regalia/medal-first.webp"
import team from "@/imports/regalia/seal-team.webp"

// Coordinates refer to the unchanged source sheets. SVG viewports separate the
// artwork without re-drawing inscriptions or pretending a matte has alpha.
const sheets = {
  signal: { src: signal, width: 1536, height: 1024 },
  bureau: { src: bureau, width: 1448, height: 1086 },
  latin: { src: latin, width: 1536, height: 1024 },
  ornate: { src: ornate, width: 1448, height: 1086 },
  classic: { src: classic, width: 1448, height: 1086 },
}
const plate = (sheet: keyof typeof sheets, box: string, label: string) => ({
  ...sheets[sheet],
  box,
  label,
  cutout: false,
})
const cutout = (src: string, label: string) => ({
  src,
  width: 384,
  height: 384,
  box: "0 0 384 384",
  label,
  cutout: true,
})
export const REGALIA = {
  "medal-first": cutout(first, "First Case"),
  "medal-shadow": plate("signal", "550 10 445 460", "Shadow Ops"),
  "medal-team": plate("signal", "1040 12 435 455", "Team Player"),
  "medal-danger": plate("signal", "52 475 458 492", "No Mercy"),
  "medal-consistent": plate("signal", "545 475 445 482", "Consistent"),
  "medal-support": plate("signal", "1062 475 385 488", "Quiet Impact"),
  "medal-flawless": plate("bureau", "65 40 450 433", "Без права на ошибку"),
  "medal-versatile": plate("bureau", "528 50 397 424", "Гибкий оперативник"),
  "medal-archive": plate("bureau", "950 44 460 428", "Полевой архив"),
  "medal-witness": plate("bureau", "85 522 404 426", "Свидетели на месте"),
  "medal-common": plate("bureau", "520 520 411 436", "Общее дело"),
  "medal-last": plate("bureau", "958 520 446 443", "Последняя страница"),
  "seal-compass": plate("classic", "12 32 455 475", "Компас"),
  "seal-adapt": plate("classic", "490 32 458 475", "Хамелеон"),
  "seal-archive": plate("classic", "968 42 476 465", "Документы"),
  "seal-witness": plate("classic", "14 525 463 490", "Сыщики"),
  "seal-team": cutout(team, "Руки"),
  "seal-time": plate("classic", "970 515 474 502", "Часы"),
  "seal-justice": plate("latin", "44 17 462 478", "Правосудие"),
  "seal-secret": plate("latin", "526 18 478 476", "Тайное знание"),
  "seal-support": plate("latin", "1040 18 468 476", "Поддержка"),
  "seal-end": plate("latin", "38 503 474 477", "Новая глава"),
  "seal-night": plate("latin", "531 500 470 480", "Время"),
  "seal-flight": plate("latin", "1042 502 474 478", "Общий город"),
  "seal-ornate-compass": plate("ornate", "8 18 469 487", "Парадный компас"),
  "seal-crown": plate("ornate", "485 17 477 491", "Коронованный глаз"),
  "seal-book": plate("ornate", "969 22 475 486", "Книга архива"),
  "seal-city": plate("ornate", "9 517 471 510", "Город"),
  "seal-ornate-team": plate("ornate", "481 517 481 509", "Круг бюро"),
  "seal-ornate-time": plate("ornate", "966 516 478 511", "Песочные часы"),
} as const
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
