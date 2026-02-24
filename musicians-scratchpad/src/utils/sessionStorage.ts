import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, SessionSummary } from './sessionTypes';

const INDEX_KEY = 'sessions_index';
const SESSION_PREFIX = 'session_';

function sessionKey(id: string): string {
  return `${SESSION_PREFIX}${id}`;
}

/** List all saved sessions (summary only, no note data). */
export async function listSessions(): Promise<SessionSummary[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  const summaries: SessionSummary[] = JSON.parse(raw);
  return summaries.sort((a, b) => b.createdAt - a.createdAt);
}

/** Save a session (both index entry and full data). */
export async function saveSession(session: Session): Promise<void> {
  const summaries = await listSessions();
  const existing = summaries.findIndex((s) => s.id === session.id);
  const summary: SessionSummary = {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    durationMs: session.durationMs,
    noteCount: session.notes.length,
  };

  if (existing >= 0) {
    summaries[existing] = summary;
  } else {
    summaries.unshift(summary);
  }

  await AsyncStorage.multiSet([
    [INDEX_KEY, JSON.stringify(summaries)],
    [sessionKey(session.id), JSON.stringify(session)],
  ]);
}

/** Load a full session by ID. */
export async function loadSession(id: string): Promise<Session | null> {
  const raw = await AsyncStorage.getItem(sessionKey(id));
  if (!raw) return null;
  return JSON.parse(raw) as Session;
}

/** Delete a session. */
export async function deleteSession(id: string): Promise<void> {
  const summaries = await listSessions();
  const filtered = summaries.filter((s) => s.id !== id);
  await AsyncStorage.multiSet([[INDEX_KEY, JSON.stringify(filtered)]]);
  await AsyncStorage.removeItem(sessionKey(id));
}

/** Rename a session. */
export async function renameSession(id: string, newName: string): Promise<void> {
  const summaries = await listSessions();
  const entry = summaries.find((s) => s.id === id);
  if (entry) {
    entry.name = newName;
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(summaries));
  }

  const session = await loadSession(id);
  if (session) {
    session.name = newName;
    await AsyncStorage.setItem(sessionKey(id), JSON.stringify(session));
  }
}
