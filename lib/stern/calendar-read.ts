type CalendarIdentity = {
  account: string; event_id: string; start_at: string;
  coffee_chat_id: number; person_id: number;
};

/** Keep source records intact; hide an invitation only when a real booking identifies the same meeting. */
export function withoutSupersededInvites<T extends CalendarIdentity>(events: T[]): T[] {
  const real = events.filter(e => e.event_id && !/^(invite:|dry-run:)/.test(e.event_id));
  return events.filter(invite => {
    if (!invite.event_id.startsWith("invite:")) return true;
    const at = Date.parse(invite.start_at);
    if (!Number.isFinite(at)) return true;
    return !real.some(event => {
      if (event.account.toLowerCase() !== invite.account.toLowerCase() || Date.parse(event.start_at) !== at) return false;
      // Conflicting linked identities are never reconciled by a title or time coincidence.
      if (event.person_id && invite.person_id && event.person_id !== invite.person_id) return false;
      if (event.coffee_chat_id && invite.coffee_chat_id) return event.coffee_chat_id === invite.coffee_chat_id;
      return !!event.person_id && event.person_id === invite.person_id;
    });
  });
}
