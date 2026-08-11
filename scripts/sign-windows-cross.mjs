import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const input = process.argv[2];
const certificate = process.env.ONPEOPLE_WINDOWS_CERTIFICATE;
const password = process.env.ONPEOPLE_WINDOWS_CERTIFICATE_PASSWORD;
const signer = process.env.OSSLSIGNCODE || "osslsigncode";

if (!input || !fs.statSync(input, { throwIfNoEntry: false })?.isFile()) {
  throw new Error(
    "sign-windows-cross requires an existing EXE, DLL, or MSIX path",
  );
}
if (
  !certificate ||
  !fs.statSync(certificate, { throwIfNoEntry: false })?.isFile()
) {
  throw new Error(
    "ONPEOPLE_WINDOWS_CERTIFICATE must point to a Windows code-signing PFX",
  );
}
if (password === undefined) {
  throw new Error("ONPEOPLE_WINDOWS_CERTIFICATE_PASSWORD is required");
}

const parsed = path.parse(input);
const output = path.join(
  parsed.dir,
  `${parsed.name}.onpeople-signed-${process.pid}${parsed.ext}`,
);
const result = spawnSync(
  signer,
  [
    "sign",
    "-pkcs12",
    certificate,
    "-pass",
    password,
    "-h",
    "sha256",
    "-n",
    "OnPeople",
    "-i",
    "https://aibro.vip/",
    "-t",
    process.env.ONPEOPLE_WINDOWS_TIMESTAMP_URL ||
      "http://timestamp.digicert.com",
    "-in",
    input,
    "-out",
    output,
  ],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  fs.rmSync(output, { force: true });
  throw new Error(`osslsigncode failed with status ${result.status}`);
}
fs.renameSync(output, input);

const verify = spawnSync(signer, ["verify", "-in", input], {
  stdio: "inherit",
});
if (verify.error) throw verify.error;
if (verify.status !== 0) {
  throw new Error(
    `osslsigncode verification failed with status ${verify.status}`,
  );
}
