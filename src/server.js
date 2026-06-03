const http = require("node:http");
const { createApp } = require("./app");
const { createHandler } = require("./router");

const port = Number(process.env.PORT || 3000);
const resetOnStart = process.env.RESET_DATA === "1";
const app = createApp({ resetOnStart });
const server = http.createServer(createHandler(app));

server.listen(port, () => {
  console.log(`CampusGather is running at http://localhost:${port}`);
});

module.exports = { server, app };
