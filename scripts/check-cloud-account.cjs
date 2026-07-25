const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {
  CloudAccountClient,
  DEFAULT_SERVICE_URL,
  normalizeServiceUrl,
} = require("../src/cloud-account.cjs");

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
  assert.equal(migratedCredentials.schemaVersion, 3);
  assert.ok(migratedCredentials.encryptedAccessToken);

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

  let createdKey = false;
  let redeemed = false;
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
      assert.equal(request.headers.authorization, "Bearer sk-onpeople-desktop");
      response.setHeader("content-type", "application/json");
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
        items: createdKey ? [{
          id: 12,
          name: "OnPeople Desktop",
          key: "sk-onpeople-desktop",
          status: "active",
          group_id: 3,
        }] : [],
        total: createdKey ? 1 : 0,
      });
    }
    if (url.pathname === "/api/v1/groups/available") {
      return success(response, [
        { id: 4, name: "OpenAI", platform: "openai", status: "active" },
        { id: 3, name: "统一模型", platform: "composite", status: "active" },
      ]);
    }
    if (url.pathname === "/api/v1/keys" && request.method === "POST") {
      assert.deepEqual(body, { name: "OnPeople Desktop", group_id: 3 });
      createdKey = true;
      return success(response, {
        id: 12,
        name: "OnPeople Desktop",
        key: "sk-onpeople-desktop",
        status: "active",
        group_id: 3,
      });
    }
    if (url.pathname === "/api/v1/redeem") {
      assert.equal(body.code, "TEAM-CREDIT");
      redeemed = true;
      return success(response, { message: "兑换成功", type: "balance", value: 5 });
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
    assert.equal(status.models[0].id, "gpt-5.6-sol");
    assert.deepEqual(client.providerCredentials(), {
      baseUrl: `${serviceUrl}/v1`,
      apiKey: "sk-onpeople-desktop",
    });

    const redeemedResult = await client.redeem("TEAM-CREDIT");
    assert.equal(redeemedResult.state.account.balanceUSD, 15.5);

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
    assert.equal(offline.account.email, "user@example.com");
    assert.equal(offline.models[0].id, "gpt-5.6-sol");

    client.clearCredentials();
    assert.equal((await client.status()).signedIn, false);
    const stored = fs.readFileSync(path.join(root, "account.json"), "utf8");
    assert.doesNotMatch(stored, /jwt-access|jwt-refresh|sk-onpeople-desktop/);
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
