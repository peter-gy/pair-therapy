const PASSTHROUGH = [
  "HOME",
  "PATH",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
  "TERM",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;

export function isolateEnvironment(
  source: Record<string, string>,
): Record<string, string> {
  // RpcClient merges its environment over process.env. Blank every inherited
  // entry before restoring the process settings needed by Pi and shell tools.
  const isolated = Object.fromEntries(
    Object.keys(source).map((name) => [name, ""]),
  );
  for (const name of PASSTHROUGH) {
    if (source[name]) isolated[name] = source[name];
  }
  return isolated;
}
