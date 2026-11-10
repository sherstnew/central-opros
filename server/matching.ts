import type { Extracted, Feedback, Offer, Profile } from "../shared/model";
export function ageAt(birthDate: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const d = new Date(`${birthDate}T12:00:00Z`);
  if (Number.isNaN(+d) || d > now) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())
  )
    age--;
  return age;
}
export function hardMismatch(
  offer: Extracted,
  profile: Profile,
  now = new Date(),
): string | null {
  if (
    offer.deadline &&
    Number.isFinite(Date.parse(offer.deadline)) &&
    new Date(offer.deadline) < now
  )
    return "Набор завершён";
  if (
    offer.startsAt &&
    Number.isFinite(Date.parse(offer.startsAt)) &&
    new Date(offer.startsAt) < now
  )
    return "Дата участия прошла";
  const age = ageAt(profile.birthDate, now);
  if (
    age !== null &&
    ((offer.ageMin !== null && age < offer.ageMin) ||
      (offer.ageMax !== null && age > offer.ageMax))
  )
    return "Не подходит возраст";
  if (
    offer.format === "offline" &&
    offer.city &&
    profile.city &&
    offer.city.toLocaleLowerCase("ru").trim() !==
      profile.city.toLocaleLowerCase("ru").trim()
  )
    return "Другой город";
  return null;
}
export function dedupCandidate(a: Extracted, b: Offer) {
  if (
    a.applyUrl &&
    a.applyUrl === b.applyUrl &&
    a.title.toLowerCase() === b.title.toLowerCase() &&
    a.startsAt === b.startsAt
  )
    return true;
  return (
    a.dedupKey.length > 8 &&
    a.dedupKey === b.dedupKey &&
    a.reward === b.reward &&
    a.startsAt === b.startsAt &&
    a.organizer === b.organizer &&
    a.title.toLowerCase() === b.title.toLowerCase()
  );
}
export function feedbackContext(feedback: Feedback[]) {
  return feedback
    .filter((x) => x.reason || x.permanent)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 60)
    .map(({ reason, permanent, rule, title, category, createdAt }) => ({
      reason,
      permanent,
      rule,
      title,
      category,
      createdAt,
    }));
}
