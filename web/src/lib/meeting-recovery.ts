export interface MeetingRecovery {
  id: string;
  title: string;
  folder: string;
  sessions: [number, { wall: number; start: number }][];
}

export const meetingRecoveryKey = (user: string) => `noter-meeting-library:${user}`;

export function readMeetingRecovery(user?: string): MeetingRecovery | undefined {
  if (!user) return;
  try {
    const value = JSON.parse(localStorage.getItem(meetingRecoveryKey(user)) ?? "null");
    if (!value || typeof value.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(value.id)) return;
    return {
      id: value.id,
      title: typeof value.title === "string" ? value.title : "Meeting",
      folder: typeof value.folder === "string" ? value.folder : "",
      sessions: Array.isArray(value.sessions)
        ? value.sessions.filter(
            (entry: unknown) =>
              Array.isArray(entry) &&
              Number.isInteger(entry[0]) &&
              entry[0] >= 0 &&
              entry[1] &&
              Number.isFinite(entry[1].wall) &&
              Number.isFinite(entry[1].start) &&
              entry[1].start >= 0,
          )
        : [],
    };
  } catch {
    return;
  }
}

export function saveMeetingRecovery(user: string | undefined, recovery?: MeetingRecovery) {
  if (!user) return;
  if (recovery) localStorage.setItem(meetingRecoveryKey(user), JSON.stringify(recovery));
  else localStorage.removeItem(meetingRecoveryKey(user));
}
