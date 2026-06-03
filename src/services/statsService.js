class StatsService {
  constructor(store) {
    this.store = store;
  }

  dashboard() {
    const sessions = this.store.all("game_sessions");
    const complaints = this.store.all("complaints");
    const creditRecords = this.store.all("credit_records");
    const reservations = this.store.all("venue_reservations");
    return {
      users: this.store.all("users").length,
      verified_users: this.store.all("users").filter((user) => user.auth_status === "verified").length,
      sessions: sessions.length,
      recruiting_sessions: sessions.filter((session) => session.status === "recruiting").length,
      finished_sessions: sessions.filter((session) => session.status === "finished").length,
      applications: this.store.all("session_applications").length,
      complaints: complaints.length,
      pending_complaints: complaints.filter((item) => item.status === "pending").length,
      credit_changes: creditRecords.length,
      venue_reservations: reservations.length,
      pending_venue_reservations: reservations.filter((item) => item.status === "pending").length,
      popular_games: this.popularGames(sessions),
    };
  }

  popularGames(sessions) {
    const games = this.store.all("game_libs");
    const counts = new Map();
    for (const session of sessions) {
      counts.set(session.game_id, (counts.get(session.game_id) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([gameId, count]) => ({
        game_id: gameId,
        name: games.find((game) => game.id === gameId)?.name || gameId,
        count,
      }));
  }
}

module.exports = { StatsService };
