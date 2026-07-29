const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {
  CloudAccountClient,
  DEFAULT_SERVICE_URL,
  normalizeServiceUrl,
  preferredModelId,
} = require("../src/cloud-account.cjs");

const index = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "renderer.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8");
assert.match(renderer, /async function refreshCloudGroups\(\)/, "cloud account UI must implement group refresh");
assert.match(renderer, /\$\("#cloud-group-select"\)\.addEventListener\("change"/, "cloud group selection must update the active API key");
assert.match(index, /<select id="onpeople-model"/, "OnPeople models must use the custom dynamic select");
assert.doesNotMatch(index, /<option value="sub2api"/, "Sub2API must not appear as a duplicate Router provider");
assert.doesNotMatch(renderer, /^\s*sub2api:\s*\{/m, "renderer must not keep a hard-coded Sub2API model fallback");
assert.doesNotMatch(mainSource, /^\s*sub2api:\s*\{/m, "main process must not register Sub2API as a duplicate Router provider");
assert.match(mainSource, /const DEFAULT_CLOUD_SERVICE_URL = "https:\/\/sub2api\.aibro\.vip";/, "OnPeople cloud traffic must default to the public service");
assert.match(mainSource, /store\.type === "sub2api"/, "legacy Sub2API provider settings must migrate to OnPeople");
assert.match(mainSource, /entry\.activeType === "sub2api"/, "legacy task provider settings must migrate to OnPeople");
assert.match(renderer, /未使用本地回退/, "model discovery failure must be explicit in the UI");
assert.match(renderer, /preferredOnPeopleModel\(models, selected\)/, "a new task must select its live OnPeople default instead of clearing the model");
assert.match(mainSource, /cloudAccount\.resolveModelId\(\)/, "execution must resolve an empty OnPeople model from the live Sub2API catalog");
assert.match(mainSource, /settings\.type !== "onpeople" && settings\.apiKey/, "dynamic OnPeople group credentials must not require a manual Router save");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "onpeople-sub2api-account-"));
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`),
  decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
};

function success(response, data) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ code: 0, message: "success", data }));
}

async function main() {
  assert.equal(preferredModelId([
    { id: "gpt-5.6-terra", groupId: 4 },
    { id: "gpt-5.6-sol", groupId: 3 },
  ], 3), "gpt-5.6-sol", "a new task should inherit the active Sub2API group's first live model");
  assert.equal(preferredModelId([
    { id: "gpt-5.6-terra", groupId: 4 },
    { id: "gpt-5.6-sol", groupId: 3 },
  ], 3, "gpt-5.6-terra"), "gpt-5.6-terra", "an available task selection must be preserved");
  assert.throws(() => normalizeServiceUrl("http://example.com"), /HTTPS/);
  assert.equal(normalizeServiceUrl("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080");
  const legacyFile = path.join(root, "legacy-account.json");
  fs.writeFileSync(legacyFile, JSON.stringify({
    schemaVersion: 2,
    serviceUrl: "http://127.0.0.1:8080",
  }));
  const migratedClient = new CloudAccountClient({ filePath: legacyFile, safeStorage });
  assert.equal(migratedClient.serviceUrl(), DEFAULT_SERVICE_URL);

  const customFile = path.join(root, "custom-account.json");
  fs.writeFileSync(customFile, JSON.stringify({
    schemaVersion: 2,
    serviceUrl: "https://router.example.com/v1",
  }));
  const customClient = new CloudAccountClient({ filePath: customFile, safeStorage });
  assert.equal(customClient.serviceUrl(), "https://router.example.com");

  const credentialMigrationFile = path.join(root, "credential-migration-account.json");
  fs.writeFileSync(credentialMigrationFile, JSON.stringify({
    schemaVersion: 2,
    serviceUrl: "https://sub2api.aibro.vip",
    encryptedAccessToken: Buffer.from("encrypted:legacy-access").toString("base64"),
    encryptedRefreshToken: Buffer.from("encrypted:legacy-refresh").toString("base64"),
    encryptedApiKey: Buffer.from("encrypted:legacy-api-key").toString("base64"),
    apiKeyId: 9,
    group: { id: 3, name: "统一模型" },
  }));
  const credentialMigrationClient = new CloudAccountClient({
    filePath: credentialMigrationFile,
    safeStorage,
  });
  assert.equal(credentialMigrationClient.accessToken(), "legacy-access");
  assert.equal(credentialMigrationClient.refreshToken(), "legacy-refresh");
  assert.equal(credentialMigrationClient.apiKey(), "legacy-api-key");
  const migratedCredentials = JSON.parse(fs.readFileSync(credentialMigrationFile, "utf8"));
  assert.equal(migratedCredentials.schemaVersion, 4);
  assert.ok(migratedCredentials.encryptedAccessToken);
  assert.ok(migratedCredentials.groupCredentials["3"], "legacy active key must migrate into the per-group key ring");

  const unreachableClient = new CloudAccountClient({
    filePath: path.join(root, "unreachable-account.json"),
    safeStorage,
    defaultServiceUrl: "http://127.0.0.1:1",
  });
  await assert.rejects(
    unreachableClient.fetchJson("http://127.0.0.1:1/health", { timeoutMs: 1_000 }),
    (error) => error.code === "CLOUD_NETWORK_ERROR"
      && error.message.includes("无法连接 OnPeople 服务")
      && error.message.includes("http://127.0.0.1:1"),
  );
  unreachableClient.saveCredentials("https://sub2api.aibro.vip", {
    accessToken: "existing-access",
    refreshToken: "existing-refresh",
    apiKey: "existing-key",
  });
  await assert.rejects(unreachableClient.sendRegistrationCode({
    email: "new@example.com",
    serviceUrl: "http://127.0.0.1:1",
  }));
  assert.equal(unreachableClient.serviceUrl(), "https://sub2api.aibro.vip");
  assert.equal(unreachableClient.accessToken(), "existing-access");

  let createdKey = false;
  let createdOpenAiKey = false;
  let provisioningBlocked = false;
  let modelDiscoveryBlocked = false;
  let redeemed = false;
  let leaderboardPreference = { participating: false, display_name: "" };
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(request.url, "http://127.0.0.1");

    if (url.pathname === "/api/v1/auth/login") {
      assert.deepEqual(body, { email: "user@example.com", password: "secret123" });
      return success(response, {
        access_token: "jwt-access",
        refresh_token: "jwt-refresh",
        user: { id: 7, email: "user@example.com" },
      });
    }
    if (url.pathname === "/api/v1/auth/send-verify-code") {
      assert.equal(body.email, "new@example.com");
      return success(response, { message: "sent", countdown: 60 });
    }
    if (url.pathname === "/api/v1/auth/register") {
      assert.equal(body.verify_code, "123456");
      return success(response, { access_token: "jwt-access", refresh_token: "jwt-refresh" });
    }
    if (url.pathname === "/api/v1/auth/logout") {
      assert.equal(body.refresh_token, "jwt-refresh");
      return success(response, { message: "signed out" });
    }
    if (url.pathname === "/v1/models") {
      response.setHeader("content-type", "application/json");
      if (modelDiscoveryBlocked) {
        response.statusCode = 503;
        return response.end(JSON.stringify({ error: { message: "model catalog unavailable" } }));
      }
      if (request.headers.authorization === "Bearer sk-onpeople-openai") {
        return response.end(JSON.stringify({
          object: "list",
          data: [{ id: "gpt-5.6-terra", object: "model", owned_by: "sub2api" }],
        }));
      }
      assert.equal(request.headers.authorization, "Bearer sk-onpeople-desktop");
      return response.end(JSON.stringify({
        object: "list",
        data: [{ id: "gpt-5.6-sol", object: "model", owned_by: "sub2api" }],
      }));
    }

    assert.equal(request.headers.authorization, "Bearer jwt-access");
    if (url.pathname === "/api/v1/auth/me") {
      return success(response, {
        id: 7,
        email: "user@example.com",
        username: "user",
        balance: redeemed ? 15.5 : 10.5,
        frozen_balance: 0.25,
        concurrency: 3,
        status: "active",
      });
    }
    if (url.pathname === "/api/v1/keys" && request.method === "GET") {
      return success(response, {
        items: provisioningBlocked ? [] : [
          ...(createdKey ? [{
            id: 12,
            name: "OnPeople Desktop",
            key: "sk-onpeople-desktop",
            status: "active",
            group_id: 3,
          }] : []),
          ...(createdOpenAiKey ? [{
            id: 13,
            name: "OnPeople Desktop · OpenAI",
            key: "sk-onpeople-openai",
            status: "active",
            group_id: 4,
          }] : []),
        ],
        total: Number(createdKey) + Number(createdOpenAiKey),
      });
    }
    if (url.pathname === "/api/v1/groups/available") {
      if (provisioningBlocked) return success(response, []);
      return success(response, [
        {
          id: 4,
          name: "OpenAI",
          platform: "openai",
          status: "active",
          allow_live: true,
          models_list_config: { enabled: true, models: ["gpt-5.6-terra"] },
        },
        { id: 3, name: "统一模型", platform: "composite", status: "active", models: "gpt-5.6-sol" },
      ]);
    }
    if (url.pathname === "/api/v1/keys" && request.method === "POST") {
      const openAi = Number(body.group_id) === 4;
      if (openAi) {
        assert.match(body.name, /^OnPeople Desktop/);
        createdOpenAiKey = true;
      } else {
        assert.deepEqual(body, { name: "OnPeople Desktop", group_id: 3 });
        createdKey = true;
      }
      return success(response, {
        id: openAi ? 13 : 12,
        name: body.name,
        key: openAi ? "sk-onpeople-openai" : "sk-onpeople-desktop",
        status: "active",
        group_id: Number(body.group_id),
      });
    }
    if (url.pathname === "/api/v1/redeem") {
      assert.equal(body.code, "TEAM-CREDIT");
      redeemed = true;
      return success(response, { message: "兑换成功", type: "balance", value: 5 });
    }
    if (url.pathname === "/api/v1/usage/leaderboard-preference" && request.method === "PUT") {
      leaderboardPreference = body;
      return success(response, leaderboardPreference);
    }
    if (url.pathname === "/api/v1/usage/onpeople-profile") {
      assert.equal(url.searchParams.get("period"), "month");
      return success(response, {
        period: "month",
        preference: leaderboardPreference,
        current_user_rank: leaderboardPreference.participating ? 1 : 0,
        leaderboard: leaderboardPreference.participating ? [{
          rank: 1,
          display_name: leaderboardPreference.display_name,
          total_tokens: 1234,
          requests: 4,
          is_current_user: true,
        }] : [],
      });
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: 404, message: "not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const serviceUrl = `http://127.0.0.1:${server.address().port}`;
    const client = new CloudAccountClient({ filePath: path.join(root, "account.json"), safeStorage });
    assert.equal(normalizeServiceUrl(`${serviceUrl}/api/v1/`), serviceUrl);
    assert.equal(normalizeServiceUrl(`${serviceUrl}/v1`), serviceUrl);

    const status = await client.login({
      email: "user@example.com",
      password: "secret123",
      serviceUrl,
    });
    assert.equal(status.account.balanceUSD, 10.5);
    assert.equal(status.account.group.id, 3);
    assert.equal(status.modelsLive, true);
    assert.equal(status.models[0].id, "gpt-5.6-sol");
    assert.equal(status.models.some((model) => model.id === "gpt-5.6-terra"), true, "the account model catalog must include every available group");
    assert.equal((await client.resolveModelId()).modelId, "gpt-5.6-sol");
    assert.equal((await client.resolveModelId("gpt-5.6-terra")).modelId, "gpt-5.6-terra");
    assert.deepEqual(client.providerCredentials("gpt-5.6-sol"), {
      baseUrl: `${serviceUrl}/v1`,
      apiKey: "sk-onpeople-desktop",
    });
    await client.ensureModelAccess("gpt-5.6-terra");
    assert.deepEqual(client.providerCredentials("gpt-5.6-terra"), {
      baseUrl: `${serviceUrl}/v1`,
      apiKey: "sk-onpeople-openai",
    });
    const liveCredentials = await client.liveCredentials();
    assert.equal(liveCredentials.baseUrl, `${serviceUrl}/v1`);
    assert.equal(liveCredentials.apiKey, "sk-onpeople-openai");
    assert.equal(liveCredentials.group.allowLive, true);

    const groups = await client.listGroups();
    assert.equal(groups.activeGroupId, 3);
    assert.deepEqual(groups.groups.find((group) => group.id === 4).models, ["gpt-5.6-terra"]);
    assert.equal(groups.groups.find((group) => group.id === 4).allowLive, true);
    const switched = await client.selectGroup(4);
    assert.equal(switched.account.group.id, 4);
    assert.deepEqual(switched.models.map((model) => model.id), ["gpt-5.6-terra", "gpt-5.6-sol"]);
    assert.equal(client.apiKey(), "sk-onpeople-openai");
    await client.selectGroup(3);
    assert.equal(client.apiKey(), "sk-onpeople-desktop");
    assert.equal(client.providerCredentials("gpt-5.6-sol").apiKey, "sk-onpeople-desktop");
    assert.equal(client.providerCredentials("gpt-5.6-terra").apiKey, "sk-onpeople-openai");

    client.saveCredentials(serviceUrl, {
      apiKey: "sk-stale-wrong-user",
      apiKeyId: 999,
      group: { id: 3, name: "统一模型", platform: "composite" },
      groupCredentials: {
        3: {
          encryptedApiKey: client.encrypt("sk-stale-wrong-user"),
          apiKeyId: 999,
          group: { id: 3, name: "统一模型", platform: "composite" },
        },
      },
    });
    const repaired = await client.status();
    assert.equal(repaired.account.apiKeyId, 12, "status refresh must replace a stale API-key binding");
    assert.equal(client.apiKey(), "sk-onpeople-desktop");
    assert.equal(client.read().groupCredentials["3"].apiKeyId, 12);

    modelDiscoveryBlocked = true;
    const unavailableModels = await client.status();
    assert.equal(unavailableModels.signedIn, true);
    assert.equal(unavailableModels.modelsLive, false);
    assert.deepEqual(unavailableModels.models, [], "gateway failure must not reuse a cached model list");
    assert.match(unavailableModels.modelsError, /model catalog unavailable/);
    modelDiscoveryBlocked = false;
    assert.equal((await client.status()).modelsLive, true);

    const stableCredentials = client.read();
    provisioningBlocked = true;
    await assert.rejects(
      client.login({ email: "user@example.com", password: "secret123", serviceUrl }),
      /没有可用分组/,
    );
    assert.deepEqual(client.read(), stableCredentials, "failed API-key provisioning must restore the previous account");
    provisioningBlocked = false;

    const redeemedResult = await client.redeem("TEAM-CREDIT");
    assert.equal(redeemedResult.state.account.balanceUSD, 15.5);
    await client.updateLeaderboardPreference({ participating: true, displayName: "Otter Builder" });
    const profile = await client.usageProfile({ period: "month" });
    assert.equal(profile.current_user_rank, 1);
    assert.equal(profile.leaderboard[0].display_name, "Otter Builder");

    const sent = await client.sendRegistrationCode({ email: "new@example.com", serviceUrl });
    assert.equal(sent.countdown, 60);
    const registered = await client.register({
      email: "new@example.com",
      password: "secret123",
      verifyCode: "123456",
    });
    assert.equal(registered.signedIn, true);

    assert.equal((await client.logout()).signedIn, false);
    await client.login({
      email: "user@example.com",
      password: "secret123",
      serviceUrl,
    });
    await new Promise((resolve) => server.close(resolve));
    const offline = await client.status();
    assert.equal(offline.signedIn, true);
    assert.equal(offline.offline, true);
    assert.equal(offline.modelsLive, false);
    assert.equal(offline.account.email, "user@example.com");
    assert.deepEqual(offline.models, [], "offline status must not expose a stale model fallback");
    assert.deepEqual(client.read().cachedModels, [], "offline refresh must clear the stale model cache");

    client.clearCredentials();
    assert.equal((await client.status()).signedIn, false);
    const stored = fs.readFileSync(path.join(root, "account.json"), "utf8");
    assert.doesNotMatch(stored, /jwt-access|jwt-refresh|sk-onpeople-desktop|sk-onpeople-openai/);
    assert.doesNotMatch(stored, /encrypted:jwt-access/);
    process.stdout.write("Sub2API account integration checks passed\n");
  } finally {
    if (server.listening) server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
