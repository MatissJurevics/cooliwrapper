import express from "express";

export function createCoolifyRouter({ config, coolifyClient }) {
  const router = express.Router();

  router.get("/discovery", async (request, response, next) => {
    try {
      const projectUuid = request.query.project_uuid || config.coolify.defaults.project_uuid;
      const serverUuid = request.query.server_uuid || config.coolify.defaults.server_uuid;

      const [projects, servers, resources, environments, server] = await Promise.all([
        coolifyClient.listProjects(),
        coolifyClient.listServers(),
        coolifyClient.listResources(),
        projectUuid ? coolifyClient.listProjectEnvironments(projectUuid) : Promise.resolve(undefined),
        serverUuid ? coolifyClient.getServer(serverUuid) : Promise.resolve(undefined)
      ]);

      response.json({
        defaults: config.coolify.defaults,
        projects: summarizeList(projects, ["uuid", "name", "description"]),
        servers: summarizeList(servers, ["uuid", "name", "ip", "proxy_type"]),
        environments: summarizeList(environments, ["id", "name", "description"]),
        resources,
        selectedServer: server,
        notes: [
          "Use a project uuid from projects[].uuid.",
          "Use a server uuid from servers[].uuid.",
          "Use environment_name from environments[].name, or environment_uuid when your Coolify response includes UUIDs.",
          "destination_uuid is the Docker network destination UUID shown in Coolify when creating/selecting a destination. If it is not visible in this API output, copy it from the Coolify UI or from an existing resource configured for the same destination."
        ]
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function summarizeList(value, keys) {
  if (!Array.isArray(value)) return value;

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(keys.map((key) => [key, entry[key]]).filter(([, entryValue]) => entryValue !== undefined));
  });
}
