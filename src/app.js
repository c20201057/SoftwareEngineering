const path = require("node:path");
const { JsonStore } = require("./database/jsonStore");
const { UserService } = require("./services/userService");
const { NotificationService } = require("./services/notificationService");
const { LogService } = require("./services/logService");
const { GameService } = require("./services/gameService");
const { SessionService } = require("./services/sessionService");
const { VenueService } = require("./services/venueService");
const { ComplaintService } = require("./services/complaintService");
const { StatsService } = require("./services/statsService");

function createApp(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, "..");
  const dataDir = options.dataDir || path.join(rootDir, "data");
  const store = new JsonStore(dataDir, { resetOnStart: options.resetOnStart });

  const userService = new UserService(store);
  const notificationService = new NotificationService(store);
  const logService = new LogService(store);
  const gameService = new GameService(store, userService, logService);
  const sessionService = new SessionService(store, userService, gameService, notificationService, logService);
  const venueService = new VenueService(store, userService, notificationService, logService);
  const complaintService = new ComplaintService(store, userService, sessionService, notificationService, logService);
  const statsService = new StatsService(store);

  return {
    rootDir,
    publicDir: options.publicDir || path.join(rootDir, "public"),
    store,
    services: {
      userService,
      notificationService,
      logService,
      gameService,
      sessionService,
      venueService,
      complaintService,
      statsService,
    },
  };
}

module.exports = { createApp };
