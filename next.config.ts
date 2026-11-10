import type { NextConfig } from "next";

const config: NextConfig = {
  // node:sqlite is a Node built-in; keep it out of the bundler.
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false,
};

export default config;
