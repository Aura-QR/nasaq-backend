import { AnnouncementAudience } from './schemas/announcement.schema';
import type { AnnouncementStatus } from './dto/announcement.dto';

/**
 * Asia/Riyadh (SCHOOL_TIME_ZONE) keeps one offset all year — the kingdom has
 * no daylight saving — so a day's edges are fixed strings, not a lookup.
 */
const SCHOOL_UTC_OFFSET = '+03:00';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

/**
 * One edge of a slide's window, from what an admin typed.
 *
 * A bare date is a whole school day: from its first moment when it is the
 * start, to its last when it is the end. The end is the last millisecond of
 * that day rather than the next midnight, so the stored instant still reads as
 * the date that was picked when the edit screen shows it again — the next
 * midnight would come back as the following day, and every save would push the
 * end out by one.
 *
 * A time with no zone is read in the school's zone, not the server's (UTC);
 * one with a zone is taken as it is.
 */
export function scheduleEdge(value: string, edge: 'start' | 'end'): Date {
  if (DATE_ONLY.test(value)) {
    const time = edge === 'start' ? '00:00:00.000' : '23:59:59.999';
    return new Date(`${value}T${time}${SCHOOL_UTC_OFFSET}`);
  }
  if (LOCAL_DATE_TIME.test(value)) return new Date(`${value}${SCHOOL_UTC_OFFSET}`);
  return new Date(value);
}

/** What the admin list shows. Paused wins: a switched-off slide is off, whatever its dates. */
export function statusOf(
  a: { isActive: boolean; startsAt: Date; endsAt: Date | null },
  now: Date,
): AnnouncementStatus {
  if (!a.isActive) return 'paused';
  if (a.startsAt > now) return 'scheduled';
  if (a.endsAt && a.endsAt < now) return 'expired';
  return 'live';
}

/** The Mongo filter for one status — the same rules as statusOf. */
export function statusFilter(status: AnnouncementStatus, now: Date): Record<string, unknown> {
  switch (status) {
    case 'paused':
      return { isActive: false };
    case 'scheduled':
      return { isActive: true, startsAt: { $gt: now } };
    case 'expired':
      return { isActive: true, endsAt: { $ne: null, $lt: now } };
    case 'live':
      return liveFilter(now);
  }
}

/** Switched on, started, and not yet ended. What the home screen shows. */
export function liveFilter(now: Date): Record<string, unknown> {
  return {
    isActive: true,
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
  };
}

/** Which audience a signed-in role belongs to; null for one that gets no feed. */
export function audienceOf(role: string): AnnouncementAudience | null {
  switch (role) {
    case 'STUDENT':
      return 'STUDENT';
    case 'TEACHER':
      return 'TEACHER';
    case 'OWNER':
    case 'SUPERVISOR':
    case 'MANAGER':
      return 'ADMIN';
    default:
      return null;
  }
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname;
  } catch {
    return false;
  }
}

/**
 * Where a button may point: an https page, or a screen inside the app.
 *
 * Every client puts this straight into an href or a router call, so anything
 * else — `javascript:`, `data:`, a protocol-relative `//host` that leaves the
 * app — is refused here once rather than trusted to every client.
 */
export function isSafeButtonLink(value: string): boolean {
  if (/^\/(?![/\\])[^\s\\]*$/.test(value)) return true;
  return isHttpsUrl(value);
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video id in a YouTube link, or null. Mobile hands the id to the native
 * player; web builds the embed URL from it.
 */
export function youtubeIdOf(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, first, second] = url.pathname.split('/');
    if (first === 'watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(first)) id = second ?? null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** «أحمد محمد العتيبي» from a student record — first, father's, family. */
export function studentFullName(s: { firstName?: string; fatherName?: string; familyName?: string; name?: string }): string {
  const parts = [s.firstName, s.fatherName, s.familyName].map((p) => (p ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(' ') : (s.name ?? '').trim();
}

/** Trimmed, with an empty string stored as null. */
export function cleanText(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text ? text : null;
}
